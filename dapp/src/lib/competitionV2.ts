import { fetchAllDrops } from "@/lib/subgraph";
import { resolveRoots, filterVerified } from "@/lib/roots";
import { getRedis, keys } from "@/lib/redis";
import { DROP_STATUS } from "@/types";
import {
  MIN_DROP_WEI_DEFAULT, REFERRAL_BONUS_WEIGHT_DEFAULT, DOWNLINE_WEIGHTS_DEFAULT,
  type CompConfig,
} from "@/lib/competition";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface ReachClaimer {
  root: string;        // a person who claimed your drop(s)
  referred: boolean;   // did YOU refer them? (badge only)
  gG: number;          // total G$ that reached them via your claimed drops (whole G$)
}

export interface ScoreEntry {
  root: string;          // identity root (payout target) — always a VERIFIED human
  reach: number;         // distinct verified people who claimed YOUR in-window drops
  claims: number;        // distinct verified people whose in-window drops YOU claimed
  refs: number;          // verified people you referred DURING the window
  depth: number;         // network bonus points from your downline's activity
  downline: number;      // how many downline members contributed to that bonus
  base: number;          // reach + claims + refWeight × refs (your own activity)
  score: number;         // base + depth  (the rank key)
  dropsClaimed: number;  // how many of your drops got claimed (display)
  gDropped: number;      // total G$ that actually reached people (whole G$)
  claimers: ReachClaimer[];
}

export interface CompStats {
  gCirculated: number;   // whole G$ that reached people via in-window claims
  drops: number;         // drops created in-window
  claims: number;        // drops claimed in-window
  referredUsers: number; // people referred in-window
}

export interface ScoreBoard { entries: ScoreEntry[]; stats: CompStats }

const EMPTY: ScoreBoard = { entries: [], stats: { gCirculated: 0, drops: 0, claims: 0, referredUsers: 0 } };
const addTo = (m: Map<string, Set<string>>, k: string, v: string) => {
  let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(v);
};

// ── Competition scoring ──────────────────────────────────────────────────────
// Four ways to earn, folded into one score:
//   • REACH   — distinct verified people who CLAIMED a drop YOU created
//   • CLAIMS  — distinct verified people whose drops YOU claimed
//   • REFS    — verified people you REFERRED during the window
//   • DEPTH   — a fraction of your referees' base score (level 1) and your
//               referees' referees' base score (level 2) — a network bonus.
//   base  = reach + claims + refWeight × refs
//   score = base + downlineWeights[0]·Σ base(L1) + downlineWeights[1]·Σ base(L2)
//
// Airtight & bounded:
//   • Every claimer is GoodDollar-verified on-chain; droppers are verified too.
//     A drop→claim pair only counts when BOTH are verified real humans, and all
//     of one person's wallets collapse to one identity root — no double counting.
//   • REACH/CLAIMS are DISTINCT-people counts → a 2-person G$ loop is capped at
//     reach 1 + claim 1 each and can't out-score someone who reaches many people.
//   • The referral tree is verified + immutable (first-referrer-wins). DEPTH is
//     only 2 levels, uses each downline member's BASE (never their depth, so no
//     runaway cascade), and never credits a node through itself (cycle guard).
// Fast: one cached subgraph read, one cached root multicall, one verification
// multicall, and a handful of batched Redis ops (mget/pipeline) — no per-user
// round-trips. Stateless: recomputed each read, nothing to corrupt or farm.
export async function computeScores(cfg: CompConfig): Promise<ScoreBoard> {
  const redis = getRedis();
  if (!redis) return EMPTY;

  const minWei = BigInt(cfg.minDropWei ?? MIN_DROP_WEI_DEFAULT);
  const refWeight = cfg.referralBonusWeight ?? REFERRAL_BONUS_WEIGHT_DEFAULT;
  const dw = cfg.downlineWeights?.length ? cfg.downlineWeights : DOWNLINE_WEIGHTS_DEFAULT;
  const l1 = dw[0] ?? 0, l2 = dw[1] ?? 0;

  const drops = await fetchAllDrops();
  const inWin = (t: number) => t >= cfg.startsAt && t < cfg.endsAt;

  // ── Competition-wide stats (all in-window claims, independent of scoring) ──
  const claimsAll = drops.filter((d) => d.status === DROP_STATUS.Claimed && d.claimer !== ZERO && inWin(d.claimedAt));
  const stats: CompStats = {
    gCirculated: Math.round(Number(claimsAll.reduce((s, d) => s + d.amount, 0n) / 10n ** 18n)),
    drops: drops.filter((d) => inWin(d.createdAt)).length,
    claims: claimsAll.length,
    referredUsers: 0, // filled after refs are counted
  };

  // ── Scoring set: in-window claims of drops worth ≥ minDrop ──
  const claimed = claimsAll.filter((d) => d.amount >= minWei);
  if (claimed.length === 0 && (await redis.scard(keys.compReferrers())) === 0) return { entries: [], stats };

  const addrs = new Set<string>();
  for (const d of claimed) { addrs.add(d.dropper.toLowerCase()); addrs.add(d.claimer.toLowerCase()); }
  const roots = await resolveRoots([...addrs]);
  const rootOf = (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase();

  const dropperClaimers = new Map<string, Map<string, bigint>>();
  const claimerDroppers = new Map<string, Set<string>>();
  const dropCount = new Map<string, number>();
  for (const d of claimed) {
    const dr = rootOf(d.dropper), cl = rootOf(d.claimer);
    if (dr === cl) continue;
    let m = dropperClaimers.get(dr); if (!m) { m = new Map(); dropperClaimers.set(dr, m); }
    m.set(cl, (m.get(cl) ?? 0n) + d.amount);
    addTo(claimerDroppers, cl, dr);
    dropCount.set(dr, (dropCount.get(dr) ?? 0) + 1);
  }

  const enrolledReferrers = ((await redis.smembers<string[]>(keys.compReferrers())) ?? []).map((r) => r.toLowerCase());

  // ── Referral tree: parent (referredBy) of every candidate, then grandparents ──
  const candidates = [...new Set([...dropperClaimers.keys(), ...claimerDroppers.keys(), ...enrolledReferrers])];
  if (candidates.length === 0) return { entries: [], stats };

  const parentRaw = await redis.mget<(string | null)[]>(...candidates.map((c) => keys.referredBy(c)));
  const parentOf = new Map<string, string | null>();
  candidates.forEach((c, i) => parentOf.set(c, parentRaw[i] ? parentRaw[i]!.toLowerCase() : null));

  const parents = [...new Set(candidates.map((c) => parentOf.get(c)).filter((x): x is string => !!x))];
  const gpRaw = parents.length ? await redis.mget<(string | null)[]>(...parents.map((p) => keys.referredBy(p))) : [];
  const grandOf = new Map<string, string | null>(); // referredBy of each parent
  parents.forEach((p, i) => grandOf.set(p, gpRaw[i] ? gpRaw[i]!.toLowerCase() : null));
  const grandparents = [...new Set(parents.map((p) => grandOf.get(p)).filter((x): x is string => !!x))];

  // ── Verification, made STICKY so points never vanish when a 3-day/6-month
  // GoodDollar verification lapses. A root counts as verified if it is:
  //   • verified right now (filterVerified), OR
  //   • ever seen verified earlier this competition (persisted set), OR
  //   • a claimer of an in-window drop — claiming reverts on-chain unless verified,
  //     so the claim is permanent proof, OR
  //   • someone who was referred (referredBy set) — referral crediting requires the
  //     invitee to pass verification, so the credit is permanent proof too.
  // The last two are read from durable history (subgraph + referral map), so a
  // lapsed person's already-earned points are restored automatically on recompute —
  // no migration needed — and nobody unverified can slip in.
  const involvedArr = [...new Set([...candidates, ...parents, ...grandparents])];
  const live = await filterVerified(involvedArr);
  const seenKey = keys.compVerifiedSeen(cfg.id);
  const seenPrev = new Set<string>((await redis.smembers<string[]>(seenKey)) ?? []);
  const provenByClaim = claimerDroppers; // keys = roots that claimed in-window (on-chain proof)
  const verified = new Set<string>();
  for (const r of involvedArr) if (live.has(r) || seenPrev.has(r) || provenByClaim.has(r) || !!parentOf.get(r)) verified.add(r);
  // Persist anyone newly proven verified so a later lapse can't erase their points.
  const toPersist = [...new Set([...live, ...provenByClaim.keys()])].filter((r) => !seenPrev.has(r));
  if (toPersist.length) {
    try { await redis.sadd(seenKey, toPersist[0], ...toPersist.slice(1)); await redis.expire(seenKey, 60 * 60 * 24 * 120); } catch { /* best-effort */ }
  }
  const verifiedCandidates = candidates.filter((c) => verified.has(c));

  // ── In-window referral counts — one pipelined round-trip ──
  const refsOf = new Map<string, number>();
  if (verifiedCandidates.length) {
    const pipe = redis.pipeline();
    for (const r of verifiedCandidates) pipe.zcount(keys.referralCredited(r), cfg.startsAt, cfg.endsAt);
    const counts = await pipe.exec<number[]>();
    verifiedCandidates.forEach((r, i) => refsOf.set(r, Number(counts[i] ?? 0)));
  }
  stats.referredUsers = [...refsOf.values()].reduce((s, n) => s + n, 0);

  // ── Base score per verified candidate ──
  interface Base { reach: number; claims: number; refs: number; base: number; gDropped: number; dropsClaimed: number; claimers: ReachClaimer[] }
  const baseOf = new Map<string, Base>();
  for (const root of verifiedCandidates) {
    const cm = dropperClaimers.get(root);
    const claimers: ReachClaimer[] = cm
      ? [...cm.entries()].filter(([cl]) => verified.has(cl)).map(([cl, wei]) => ({
          root: cl, referred: parentOf.get(cl) === root, gG: Math.round(Number(wei / 10n ** 16n) / 100),
        }))
      : [];
    const reach = claimers.length;
    const claims = claimerDroppers.get(root) ? [...claimerDroppers.get(root)!].filter((dr) => verified.has(dr)).length : 0;
    const refs = refsOf.get(root) ?? 0;
    const base = reach + claims + refWeight * refs;
    const gDropped = claimers.reduce((s, c) => s + c.gG, 0);
    claimers.sort((a, b) => Number(b.referred) - Number(a.referred) || b.gG - a.gG);
    baseOf.set(root, { reach, claims, refs, base, gDropped, dropsClaimed: dropCount.get(root) ?? 0, claimers });
  }

  // ── Depth (network) bonus: credit ancestors for each active node's base ──
  const depthOf = new Map<string, number>();
  const downlineOf = new Map<string, Set<string>>();
  for (const [node, b] of baseOf) {
    if (b.base <= 0) continue;
    const p1 = parentOf.get(node) ?? null;
    if (!p1 || p1 === node || !verified.has(p1)) continue;
    depthOf.set(p1, (depthOf.get(p1) ?? 0) + l1 * b.base);
    addTo(downlineOf, p1, node);
    const p2 = grandOf.get(p1) ?? null;
    if (!p2 || p2 === node || p2 === p1 || !verified.has(p2)) continue;
    depthOf.set(p2, (depthOf.get(p2) ?? 0) + l2 * b.base);
    addTo(downlineOf, p2, node);
  }

  // ── Assemble entries: verified candidates + any verified ancestor who earned depth ──
  const allRoots = new Set<string>([...baseOf.keys(), ...depthOf.keys()]);
  const entries: ScoreEntry[] = [];
  for (const root of allRoots) {
    const b = baseOf.get(root);
    const depth = Math.round((depthOf.get(root) ?? 0) * 100) / 100;
    const base = b?.base ?? 0;
    const score = Math.round((base + depth) * 100) / 100;
    if (score <= 0) continue;
    entries.push({
      root,
      reach: b?.reach ?? 0, claims: b?.claims ?? 0, refs: b?.refs ?? refsOf.get(root) ?? 0,
      depth, downline: downlineOf.get(root)?.size ?? 0, base,
      score, dropsClaimed: b?.dropsClaimed ?? 0, gDropped: b?.gDropped ?? 0, claimers: b?.claimers ?? [],
    });
  }

  entries.sort((a, b) => b.score - a.score || b.gDropped - a.gDropped || b.reach - a.reach || a.root.localeCompare(b.root));
  return { entries, stats };
}
