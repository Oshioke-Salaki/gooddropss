import { getRedis, keys } from "@/lib/redis";
import { coveredReferralSlots, type RefCompConfig } from "@/lib/competition";

export interface RefInvitee { root: string; at: number; covered: boolean }

export interface RefEntry {
  root: string;          // referrer identity root (payout target)
  count: number;         // in-window referrals credited to them
  covered: number;       // of those, how many the pot actually covers
  unlocked: boolean;     // reached the threshold?
  earnedWei: string;     // covered × perReferral (0 until unlocked)
  lastAt: number;        // unix secs of their most recent referral (tiebreak)
  invitees: RefInvitee[];// who they referred, oldest first
}

export interface RefStats {
  referrals: number;       // total in-window referrals credited
  qualifiedReferrers: number; // referrers who reached the threshold
  slots: number;           // how many referrals the pot can cover in total
  slotsUsed: number;       // covered so far
  paidOutWei: string;      // total earned across everyone
  potWei: string;
}

export interface RefBoard { entries: RefEntry[]; stats: RefStats }

// ── Referral competition scoring ─────────────────────────────────────────────
// Rules, applied deterministically from the immutable referral ledger:
//   1. Only referrals CREDITED inside the window count (crediting already requires
//      a GoodDollar-verified invitee who completed a task — Sybil-resistant).
//   2. A referrer must reach `threshold` referrals to unlock any payment.
//   3. Among UNLOCKED referrers, referrals are covered by the pot strictly in
//      credit-timestamp order (first come, first served) until the pot's slots run
//      out — so the pot can never be overspent, and the result is identical no
//      matter when or how often this runs.
//
// Cost: one SMEMBERS + one pipelined ZRANGE per participant. No per-user round
// trips, no on-chain calls — this is cheap enough to serve behind a short CDN TTL.
export async function computeReferralBoard(cfg: RefCompConfig): Promise<RefBoard> {
  const empty: RefBoard = {
    entries: [],
    stats: {
      referrals: 0, qualifiedReferrers: 0,
      slots: coveredReferralSlots(cfg), slotsUsed: 0,
      paidOutWei: "0", potWei: cfg.potWei,
    },
  };
  const redis = getRedis();
  if (!redis) return empty;

  const participants = (await redis.smembers<string[]>(keys.compReferrers(cfg.id))) ?? [];
  if (participants.length === 0) return empty;

  // Each referrer's in-window invitees WITH their credit timestamps, in one batch.
  // zrange byScore returns members ordered by score (credit time) ascending.
  const pipe = redis.pipeline();
  for (const r of participants) {
    pipe.zrange(keys.referralCredited(r), cfg.startsAt, cfg.endsAt, { byScore: true, withScores: true });
  }
  const raw = await pipe.exec<(string | number)[][]>();

  // Flatten to (referrer, invitee, creditedAt) and per-referrer lists.
  interface Row { referrer: string; invitee: string; at: number }
  const rows: Row[] = [];
  const byReferrer = new Map<string, Row[]>();
  participants.forEach((referrer, i) => {
    const flat = raw[i] ?? [];
    const list: Row[] = [];
    for (let j = 0; j < flat.length; j += 2) {
      const invitee = String(flat[j]);
      const at = Number(flat[j + 1]);
      if (!Number.isFinite(at)) continue;
      const row = { referrer, invitee, at };
      list.push(row);
      rows.push(row);
    }
    if (list.length) byReferrer.set(referrer, list);
  });
  if (rows.length === 0) return empty;

  const per = BigInt(cfg.perReferralWei);
  const slots = coveredReferralSlots(cfg);

  // Only referrals belonging to UNLOCKED referrers compete for pot slots — someone
  // who never reaches the threshold shouldn't consume the pot.
  const unlocked = new Set<string>();
  for (const [root, list] of byReferrer) if (list.length >= cfg.threshold) unlocked.add(root);

  // First come, first served: oldest credit wins the slot. Ties break on invitee
  // root so the ordering is fully deterministic across runs.
  const eligible = rows
    .filter((r) => unlocked.has(r.referrer))
    .sort((a, b) => a.at - b.at || a.invitee.localeCompare(b.invitee));
  const coveredSet = new Set<string>();
  for (let i = 0; i < eligible.length && i < slots; i++) {
    coveredSet.add(`${eligible[i].referrer}|${eligible[i].invitee}`);
  }

  const entries: RefEntry[] = [];
  for (const [root, list] of byReferrer) {
    const sorted = [...list].sort((a, b) => a.at - b.at || a.invitee.localeCompare(b.invitee));
    const invitees: RefInvitee[] = sorted.map((r) => ({
      root: r.invitee, at: r.at, covered: coveredSet.has(`${root}|${r.invitee}`),
    }));
    const covered = invitees.filter((i) => i.covered).length;
    const isUnlocked = unlocked.has(root);
    entries.push({
      root,
      count: list.length,
      covered,
      unlocked: isUnlocked,
      earnedWei: (per * BigInt(covered)).toString(),
      lastAt: sorted.length ? sorted[sorted.length - 1].at : 0,
      invitees,
    });
  }

  // Rank: most earned, then most referrals, then RECENCY (of two people tied on
  // referrals, whoever referred most recently sits on top — so a new referral
  // visibly moves you up), then a stable key so the order can never shuffle
  // between renders.
  entries.sort((a, b) => {
    const ea = BigInt(a.earnedWei), eb = BigInt(b.earnedWei);
    if (ea !== eb) return eb > ea ? 1 : -1;
    return b.count - a.count || b.lastAt - a.lastAt || a.root.localeCompare(b.root);
  });

  const slotsUsed = coveredSet.size;
  return {
    entries,
    stats: {
      referrals: rows.length,
      qualifiedReferrers: unlocked.size,
      slots,
      slotsUsed,
      paidOutWei: (per * BigInt(slotsUsed)).toString(),
      potWei: cfg.potWei,
    },
  };
}
