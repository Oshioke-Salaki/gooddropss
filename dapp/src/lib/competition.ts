import type { Redis } from "@upstash/redis";

// ── Drop competition (REACH) ─────────────────────────────────────────────────
// A time-boxed, real-money contest funded from the reward wallet. Everything the
// client shows is computed server-side from on-chain data + the referral map.
//
// Rules (all config-driven, admin-editable):
//   • You score by REACH: the number of DISTINCT GoodDollar-verified people who
//     CLAIMED a drop YOU created, in-window, worth ≥ minDrop. Each person counts
//     once — so trading G$ with the same friend all day gets you nowhere.
//   • A claimer you also REFERRED is worth an extra `referralBonusWeight` points.
//   • Both dropper and claimer must be verified (claiming is verification-gated
//     on-chain; droppers are verified in the scoring).
//   • The top N (one prize per `tiers` entry) split the pot, paid once at the end.

export interface CompConfig {
  id: string;
  startsAt: number;        // unix seconds (inclusive)
  endsAt: number;          // unix seconds (exclusive)
  potWei: string;          // total prize pool, stringified wei
  tiers: number[];         // whole-G$ prize per rank (index 0 = 1st place); length = paid places
  minDropWei?: string;         // a claimed drop only counts if it moved ≥ this much G$
  referralBonusWeight?: number; // points awarded per verified person referred in-window
  // Downline (network) bonus: you earn a fraction of your referees' base score,
  // and a smaller fraction of your referees' referees'. [level1, level2].
  downlineWeights?: number[];
}

// Reach-mode defaults, applied when a stored config predates these fields.
export const MIN_DROP_WEI_DEFAULT = (100n * 10n ** 18n).toString(); // 100 G$
export const REFERRAL_BONUS_WEIGHT_DEFAULT = 1.5;
export const DOWNLINE_WEIGHTS_DEFAULT = [0.25, 0.1]; // 25% of L1's score, 10% of L2's

// Season 3 — POINTS competition. Times are WAT (UTC+1, Nigeria — no DST):
// Wed 9 Sep 09:00 → Sat 19 Sep 18:00, 2026. Score = distinct people who claimed
// your drops (drop) + distinct people whose drops you claimed (claim) + people you
// referred in-window (refer) + downline bonus. Top-N split a 1,000,000 G$ pot, paid
// once at the end. Runs ALONGSIDE the referral competition below; the two are fully
// independent (separate configs, participant sets, leaderboards and pots).
export const COMP_DEFAULT: CompConfig = {
  id: "points-2026-09",
  startsAt: Math.floor(Date.parse("2026-09-09T09:00:00+01:00") / 1000),
  endsAt: Math.floor(Date.parse("2026-09-19T18:00:00+01:00") / 1000),
  potWei: (1_000_000n * 10n ** 18n).toString(),
  minDropWei: MIN_DROP_WEI_DEFAULT,
  referralBonusWeight: REFERRAL_BONUS_WEIGHT_DEFAULT,
  downlineWeights: DOWNLINE_WEIGHTS_DEFAULT,
  // 10 winners, min prize 80,000 G$, sums to exactly 1,000,000 G$. Edit in the admin.
  tiers: [200_000, 120_000, 105_000, 90_000, 85_000, 80_000, 80_000, 80_000, 80_000, 80_000],
};

// Whole-G$ prize for a 1-indexed rank (0 if outside the tiers). Length of `tiers`
// is the number of paid places.
export function tierPrizeG(cfg: CompConfig, rank: number): number {
  return rank >= 1 && rank <= cfg.tiers.length ? cfg.tiers[rank - 1] : 0;
}

const CONFIG_KEY = "gd:comp:config";

export async function getCompConfig(redis: Redis): Promise<CompConfig> {
  try {
    const stored = await redis.get<Partial<CompConfig>>(CONFIG_KEY);
    return stored ? { ...COMP_DEFAULT, ...stored } : COMP_DEFAULT;
  } catch {
    return COMP_DEFAULT;
  }
}

export async function setCompConfig(redis: Redis, patch: Partial<CompConfig>): Promise<CompConfig> {
  const next = { ...(await getCompConfig(redis)), ...patch };
  await redis.set(CONFIG_KEY, next);
  return next;
}

export type CompPhase = "upcoming" | "live" | "ended";

// Reach pays once at the end, so the pot never depletes during the run — the phase
// is purely time-based.
export function compPhase(cfg: CompConfig, nowSec: number): CompPhase {
  if (nowSec < cfg.startsAt) return "upcoming";
  if (nowSec >= cfg.endsAt) return "ended";
  return "live";
}

// True if `tsSec` falls inside the competition window.
export function inCompWindow(cfg: CompConfig, tsSec: number): boolean {
  return tsSec >= cfg.startsAt && tsSec < cfg.endsAt;
}

// ── Referral competition (runs alongside the points competition) ─────────────
// Flat rate per qualifying referral, first-come-first-served against a fixed pot:
//   • A referral counts only if it was CREDITED inside [startsAt, endsAt) — and
//     crediting already requires a GoodDollar-verified invitee who did a task.
//   • You unlock payment at `threshold` referrals; below that you earn nothing.
//   • Referrals are covered by the pot in the order they were credited, so the pot
//     can never be overspent. Once it's exhausted, later referrals don't earn.
// Everything is derived from the immutable referral ledger at read time — there is
// no mutable balance to corrupt, and two readers can never disagree.
export interface RefCompConfig {
  id: string;
  startsAt: number;        // unix seconds (inclusive)
  endsAt: number;          // unix seconds (exclusive)
  potWei: string;          // total prize pool, stringified wei
  perReferralWei: string;  // paid per covered referral
  threshold: number;       // referrals needed before ANY payout unlocks
}

// Season 3 — REFERRAL competition. Same window as the points competition.
// 1,000,000 G$ at 6,667 G$ each ⇒ 149 covered referrals.
export const REF_COMP_DEFAULT: RefCompConfig = {
  id: "referrals-2026-09",
  startsAt: Math.floor(Date.parse("2026-09-09T09:00:00+01:00") / 1000),
  endsAt: Math.floor(Date.parse("2026-09-19T18:00:00+01:00") / 1000),
  potWei: (1_000_000n * 10n ** 18n).toString(),
  perReferralWei: (6_667n * 10n ** 18n).toString(),
  threshold: 5,
};

const REF_CONFIG_KEY = "gd:comp:ref:config";

export async function getRefCompConfig(redis: Redis): Promise<RefCompConfig> {
  try {
    const stored = await redis.get<Partial<RefCompConfig>>(REF_CONFIG_KEY);
    return stored ? { ...REF_COMP_DEFAULT, ...stored } : REF_COMP_DEFAULT;
  } catch {
    return REF_COMP_DEFAULT;
  }
}

export async function setRefCompConfig(redis: Redis, patch: Partial<RefCompConfig>): Promise<RefCompConfig> {
  const next = { ...(await getRefCompConfig(redis)), ...patch };
  await redis.set(REF_CONFIG_KEY, next);
  return next;
}

// How many referrals the pot can cover in total (floor, so it never overspends).
export function coveredReferralSlots(cfg: RefCompConfig): number {
  const per = BigInt(cfg.perReferralWei);
  if (per <= 0n) return 0;
  return Number(BigInt(cfg.potWei) / per);
}

// Time-based, plus an early end once every pot slot is spoken for.
export function refCompPhase(cfg: RefCompConfig, nowSec: number, coveredUsed: number): CompPhase {
  if (nowSec < cfg.startsAt) return "upcoming";
  if (nowSec >= cfg.endsAt) return "ended";
  if (coveredUsed >= coveredReferralSlots(cfg)) return "ended"; // pot exhausted
  return "live";
}

export function inRefCompWindow(cfg: RefCompConfig, tsSec: number): boolean {
  return tsSec >= cfg.startsAt && tsSec < cfg.endsAt;
}
