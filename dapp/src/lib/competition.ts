import type { Redis } from "@upstash/redis";

// ── Referral competition ────────────────────────────────────────────────────
// A time-boxed referral contest funded from the reward wallet. All money math is
// server-authoritative and derived from the immutable referral ledger; the client
// only ever DISPLAYS what the server computes.
//
// Rules (all config-driven, editable by an admin so the pot can flip to 1M/1.5M):
//   • A referral counts only if it was CREDITED inside [startsAt, endsAt), and the
//     invitee is a GoodDollar-verified human who did a task (enforced at credit time).
//   • Nothing is owed until a referrer reaches `threshold` referrals. At/after that,
//     owed = count × perReferral (flat). e.g. threshold 5 → 5×6,500 = 32,500, then
//     +6,500 each additional referral.
//   • Payouts draw down the pot; the contest ends at endsAt OR when the pot is empty,
//     whichever comes first.

export interface CompConfig {
  id: string;
  startsAt: number;        // unix seconds (inclusive)
  endsAt: number;          // unix seconds (exclusive)
  potWei: string;          // total prize pool, stringified wei
  perReferralWei: string;  // paid per qualifying referral, stringified wei
  threshold: number;       // referrals required before ANY payout
}

// Times are WAT (UTC+1, Nigeria — no DST). Mon 24 Aug 12:00 → Fri 28 Aug 12:00, 2026.
export const COMP_DEFAULT: CompConfig = {
  id: "referral-sprint-2026-08",
  startsAt: Math.floor(Date.parse("2026-08-24T12:00:00+01:00") / 1000),
  endsAt: Math.floor(Date.parse("2026-08-28T12:00:00+01:00") / 1000),
  potWei: (500_000n * 10n ** 18n).toString(),
  perReferralWei: (6_500n * 10n ** 18n).toString(),
  threshold: 5,
};

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

// Amount a referrer is owed IN TOTAL for `count` in-window referrals (flat rate,
// gated by threshold). Payment tracking (paid/outstanding) is layered on top.
export function owedWei(count: number, cfg: CompConfig): bigint {
  if (count < cfg.threshold) return 0n;
  return BigInt(count) * BigInt(cfg.perReferralWei);
}

export type CompPhase = "upcoming" | "live" | "ended";

export function compPhase(cfg: CompConfig, spentWei: bigint, nowSec: number): CompPhase {
  if (nowSec < cfg.startsAt) return "upcoming";
  if (nowSec >= cfg.endsAt || BigInt(cfg.potWei) - spentWei <= 0n) return "ended";
  return "live";
}

// A referral credited at `tsSec` counts toward the contest only inside the window.
export function inCompWindow(cfg: CompConfig, tsSec: number): boolean {
  return tsSec >= cfg.startsAt && tsSec < cfg.endsAt;
}

// ZSET score bounds for the window (both inclusive; the exact-boundary second is
// immaterial). Used identically by the leaderboard (zrange/zcount) and the payout
// worker so the two can never disagree on a referrer's count.
export function windowScoreRange(cfg: CompConfig): { min: number; max: number } {
  return { min: cfg.startsAt, max: cfg.endsAt };
}
