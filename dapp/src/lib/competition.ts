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
  referralBonusWeight?: number; // extra points per distinct claimer you also referred
}

// Reach-mode defaults, applied when a stored config predates these fields.
export const MIN_DROP_WEI_DEFAULT = (100n * 10n ** 18n).toString(); // 100 G$
export const REFERRAL_BONUS_WEIGHT_DEFAULT = 1;

// Season 2 — "THE BIG DROP". Times are WAT (UTC+1, Nigeria — no DST): Mon 31 Aug
// 12:00 → Sat 5 Sep 18:00, 2026. Top-N split a 1,000,000 G$ pot, paid once at the
// end. All admin-editable.
export const COMP_DEFAULT: CompConfig = {
  id: "big-drop-2026-09",
  startsAt: Math.floor(Date.parse("2026-08-31T12:00:00+01:00") / 1000),
  endsAt: Math.floor(Date.parse("2026-09-05T18:00:00+01:00") / 1000),
  potWei: (1_000_000n * 10n ** 18n).toString(),
  minDropWei: MIN_DROP_WEI_DEFAULT,
  referralBonusWeight: REFERRAL_BONUS_WEIGHT_DEFAULT,
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
