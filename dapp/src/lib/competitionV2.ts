import { fetchAllDrops } from "@/lib/subgraph";
import { resolveRoots, filterVerified } from "@/lib/roots";
import { getRedis, keys } from "@/lib/redis";
import { DROP_STATUS } from "@/types";
import { MIN_DROP_WEI_DEFAULT, REFERRAL_BONUS_WEIGHT_DEFAULT, type CompConfig } from "@/lib/competition";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface ReachClaimer {
  root: string;        // the person who claimed your drop(s)
  referred: boolean;   // did YOU refer them? (worth a bonus point)
  gG: number;          // total G$ that reached them via your claimed drops (whole G$)
}

export interface ReachEntry {
  root: string;          // dropper identity root (payout target) — always a VERIFIED human
  reach: number;         // distinct verified people who claimed your in-window drops
  referred: number;      // of those, how many you also referred
  score: number;         // reach + weight × referred  (the leaderboard rank key)
  dropsClaimed: number;  // how many of your drops got claimed (for display)
  gDropped: number;      // total G$ that actually reached people (whole G$)
  claimers: ReachClaimer[];
}

// ── v3 metric: "REACH" ───────────────────────────────────────────────────────
// For each dropper, the number of DISTINCT verified humans who CLAIMED a drop that
// dropper CREATED, with the claim inside the window and the drop worth ≥ minDrop.
// A claimer the dropper also REFERRED is worth an extra point (referral bonus), so
// bringing NEW people and getting them to claim scores highest.
//
// Why this is airtight and moves real G$:
//   • Every claimer is a GoodDollar-verified human — claiming reverts on-chain for
//     the unverified — and all of a person's wallets collapse to ONE identity root,
//     so one human can never be counted twice.
//   • Droppers are verified too (filterVerified) — only real humans can rank/win.
//   • Counted once PER DISTINCT CLAIMER → two people ping-ponging G$ between
//     themselves are each stuck at reach = 1 forever, no matter how much they cycle.
//     You only climb by reaching MORE different people.
//   • Only CLAIMED drops count → "dropping only" (drops nobody claims) earns nothing,
//     which forces droppers to push their people to actually claim.
//   • Stateless — recomputed from the subgraph + referral map on every read, so
//     there's no ledger to corrupt and nothing to farm between reads.
export async function computeReach(cfg: CompConfig): Promise<ReachEntry[]> {
  const redis = getRedis();
  if (!redis) return [];

  const minWei = BigInt(cfg.minDropWei ?? MIN_DROP_WEI_DEFAULT);
  const weight = cfg.referralBonusWeight ?? REFERRAL_BONUS_WEIGHT_DEFAULT;

  const drops = await fetchAllDrops();
  const claims = drops.filter(
    (d) => d.status === DROP_STATUS.Claimed && d.claimer !== ZERO
      && d.claimedAt >= cfg.startsAt && d.claimedAt < cfg.endsAt
      && d.amount >= minWei,
  );
  if (claims.length === 0) return [];

  // Collapse each participating wallet to its identity root (batched multicall + cache).
  const addrs = new Set<string>();
  for (const d of claims) { addrs.add(d.dropper.toLowerCase()); addrs.add(d.claimer.toLowerCase()); }
  const roots = await resolveRoots([...addrs]);
  const rootOf = (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase();

  // dropperRoot → (claimerRoot → G$ received) plus a claimed-drop tally.
  const byDropper = new Map<string, { claimers: Map<string, bigint>; drops: number }>();
  for (const d of claims) {
    const dr = rootOf(d.dropper), cl = rootOf(d.claimer);
    if (dr === cl) continue; // claiming your own drop never counts
    const e = byDropper.get(dr) ?? { claimers: new Map<string, bigint>(), drops: 0 };
    e.claimers.set(cl, (e.claimers.get(cl) ?? 0n) + d.amount);
    e.drops += 1;
    byDropper.set(dr, e);
  }
  if (byDropper.size === 0) return [];

  // Only VERIFIED droppers may rank (claimers are already verified by the claim gate).
  const verified = await filterVerified([...byDropper.keys()]);

  // Who referred each distinct claimer (batched) — for the referral bonus.
  const allClaimers = [...new Set([...byDropper.values()].flatMap((e) => [...e.claimers.keys()]))];
  const referredBy = allClaimers.length
    ? await redis.mget<(string | null)[]>(...allClaimers.map((c) => keys.referredBy(c)))
    : [];
  const referrerOf = new Map<string, string | null>();
  allClaimers.forEach((c, i) => referrerOf.set(c, referredBy[i] ? referredBy[i]!.toLowerCase() : null));

  const entries: ReachEntry[] = [];
  for (const [dropper, e] of byDropper) {
    if (!verified.has(dropper)) continue;
    const claimers: ReachClaimer[] = [...e.claimers.entries()].map(([root, wei]) => ({
      root,
      referred: referrerOf.get(root) === dropper,
      gG: Math.round(Number(wei / 10n ** 16n) / 100), // wei → whole G$ (2-dp precision, then round)
    }));
    const referred = claimers.filter((c) => c.referred).length;
    const reach = claimers.length;
    const gDropped = claimers.reduce((s, c) => s + c.gG, 0);
    // Referred claimers first, then by G$ received — nicest badge order in the UI.
    claimers.sort((a, b) => Number(b.referred) - Number(a.referred) || b.gG - a.gG);
    entries.push({ root: dropper, reach, referred, score: reach + weight * referred, dropsClaimed: e.drops, gDropped, claimers });
  }

  // Rank: score desc, then real G$ moved, then raw reach.
  return entries.sort((a, b) => b.score - a.score || b.gDropped - a.gDropped || b.reach - a.reach);
}
