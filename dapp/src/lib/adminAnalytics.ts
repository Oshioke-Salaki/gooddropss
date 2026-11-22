// The admin Analytics page's numbers, computed from every drop. Pure (no I/O),
// so it's unit-tested and runs on the server: the page receives these totals
// instead of downloading the whole drop history into the browser.

import { DROP_STATUS, type Drop } from "@/types";
import { REWARDS_WEI } from "@/lib/circulation";

const ZERO = "0x0000000000000000000000000000000000000000";
const DAY_MS = 86_400_000;

export interface AdminAnalytics {
  total: number; active: number; claimed: number; reclaimed: number; expiredUnclaimed: number;
  claimedWei: bigint; reclaimedWei: bigint; activeWei: bigint;
  /** See lib/circulation: all drops + rewards. */
  circulatedWei: bigint;
  /** Counted by identity root. */
  droppers: number; hunters: number; humans: number;
  /** % of settled drops (claimed + reclaimed) that were found. */
  claimRate: number;
  /** Last 14 UTC days of drops created, oldest first. */
  days: { day: string; n: number }[];
  maxDay: number;
  activeToday: number;
  avgTtcSec: number;
  /** Last 14 UTC days of G$ claimed, oldest first. */
  claimedDays: { day: string; wei: bigint }[];
  maxClaimedWei: bigint;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function computeAdminAnalytics(drops: Drop[], roots: Map<string, string>, nowMs = Date.now()): AdminAnalytics {
  const now = Math.floor(nowMs / 1000);
  const rootOf = (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase();

  let claimedWei = 0n, reclaimedWei = 0n, activeWei = 0n, droppedWei = 0n;
  let active = 0, claimed = 0, reclaimed = 0, expiredUnclaimed = 0;
  const droppers = new Set<string>();
  const hunters = new Set<string>();
  const humans = new Set<string>();
  const perDay: Record<string, number> = {};
  const claimedWeiPerDay: Record<string, bigint> = {};
  const todayStr = isoDay(nowMs);
  const activeToday = new Set<string>();
  let ttcSum = 0, ttcCount = 0;

  for (const d of drops) {
    droppedWei += d.amount;
    droppers.add(rootOf(d.dropper));
    humans.add(rootOf(d.dropper));
    const day = isoDay(d.createdAt * 1000);
    perDay[day] = (perDay[day] ?? 0) + 1;

    if (d.status === DROP_STATUS.Claimed) {
      claimed++;
      claimedWei += d.amount;
      if (d.claimer !== ZERO) {
        hunters.add(rootOf(d.claimer));
        humans.add(rootOf(d.claimer));
      }
      if (d.claimedAt > 0 && d.createdAt > 0 && d.claimedAt >= d.createdAt) {
        ttcSum += d.claimedAt - d.createdAt;
        ttcCount++;
      }
      if (d.claimedAt > 0) {
        const cday = isoDay(d.claimedAt * 1000);
        claimedWeiPerDay[cday] = (claimedWeiPerDay[cday] ?? 0n) + d.amount;
        if (cday === todayStr && d.claimer !== ZERO) activeToday.add(rootOf(d.claimer));
      }
    } else if (d.status === DROP_STATUS.Reclaimed) {
      reclaimed++;
      reclaimedWei += d.amount;
    } else {
      active++;
      activeWei += d.amount;
      if (d.expiry < now) expiredUnclaimed++;
    }
  }

  const settled = claimed + reclaimed;
  const days: { day: string; n: number }[] = [];
  const claimedDays: { day: string; wei: bigint }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = isoDay(nowMs - i * DAY_MS);
    days.push({ day, n: perDay[day] ?? 0 });
    claimedDays.push({ day, wei: claimedWeiPerDay[day] ?? 0n });
  }

  return {
    total: drops.length, active, claimed, reclaimed, expiredUnclaimed,
    claimedWei, reclaimedWei, activeWei,
    circulatedWei: droppedWei + REWARDS_WEI,
    droppers: droppers.size, hunters: hunters.size, humans: humans.size,
    claimRate: settled > 0 ? Math.round((claimed / settled) * 100) : 0,
    days,
    maxDay: Math.max(1, ...days.map((x) => x.n)),
    activeToday: activeToday.size,
    avgTtcSec: ttcCount ? Math.round(ttcSum / ttcCount) : 0,
    claimedDays,
    maxClaimedWei: claimedDays.reduce((mx, x) => (x.wei > mx ? x.wei : mx), 1n),
  };
}

// JSON can't carry bigints: wei fields travel as decimal strings.
type WeiKey = "claimedWei" | "reclaimedWei" | "activeWei" | "circulatedWei" | "maxClaimedWei";
export type AdminAnalyticsJson = Omit<AdminAnalytics, WeiKey | "claimedDays"> &
  Record<WeiKey, string> & { claimedDays: { day: string; wei: string }[] };

export function analyticsToJson(a: AdminAnalytics): AdminAnalyticsJson {
  return {
    ...a,
    claimedWei: a.claimedWei.toString(), reclaimedWei: a.reclaimedWei.toString(), activeWei: a.activeWei.toString(),
    circulatedWei: a.circulatedWei.toString(), maxClaimedWei: a.maxClaimedWei.toString(),
    claimedDays: a.claimedDays.map((d) => ({ day: d.day, wei: d.wei.toString() })),
  };
}

export function analyticsFromJson(j: AdminAnalyticsJson): AdminAnalytics {
  return {
    ...j,
    claimedWei: BigInt(j.claimedWei), reclaimedWei: BigInt(j.reclaimedWei), activeWei: BigInt(j.activeWei),
    circulatedWei: BigInt(j.circulatedWei), maxClaimedWei: BigInt(j.maxClaimedWei),
    claimedDays: j.claimedDays.map((d) => ({ day: d.day, wei: BigInt(d.wei) })),
  };
}
