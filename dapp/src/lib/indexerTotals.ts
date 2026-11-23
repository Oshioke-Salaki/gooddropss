// Server-only. The subgraph's running totals (GlobalStats + DailyStats, subgraph
// v1.1.0): whole-app counts and G$ amounts, kept up to date by the indexer as
// each drop is created, claimed or reclaimed. One small query instead of
// adding up every drop.
//
// These are WALLET-level facts about drops. Anything counted per PERSON
// (droppers, hunters, users: several wallets can belong to one GoodDollar
// identity) still comes from the drop mirror + identity roots.
//
// Never throws: if the totals can't be read (indexer down, or pointed at an
// older version without them), callers get null and keep their own numbers.

import { gql } from "@/lib/subgraphClient";
import { memo } from "@/lib/serverCache";

export interface IndexerTotals {
  drops: number;
  claims: number;
  reclaims: number;
  /** Not yet claimed or reclaimed (includes expired). */
  active: number;
  droppedWei: bigint;
  claimedWei: bigint;
  reclaimedWei: bigint;
  activeWei: bigint;
  /** Unix seconds of the last change. */
  updatedAt: number;
}

export interface DayTotals {
  /** UTC day, "YYYY-MM-DD". */
  day: string;
  drops: number;
  claims: number;
  droppedWei: bigint;
  claimedWei: bigint;
}

export interface IndexerSnapshot {
  totals: IndexerTotals;
  /** UTC days that had any activity, keyed "YYYY-MM-DD". Missing day = nothing happened. */
  days: Map<string, DayTotals>;
}

/** How many recent days are fetched (the admin charts show 14). */
export const DAYS_BACK = 14;
const SECONDS_PER_DAY = 86_400;

export const isoDayOf = (dayNumber: number) => new Date(dayNumber * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);

const INT_RE = /^\d+$/;
const big = (v: unknown): bigint | null => (typeof v === "string" && INT_RE.test(v) ? BigInt(v) : null);
const num = (v: unknown): number | null => {
  const b = big(v);
  return b !== null && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : null;
};

/** Strict parse of the GlobalStats row; null if anything is missing or malformed. */
export function parseTotals(raw: unknown): IndexerTotals | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t = {
    drops: num(r.drops), claims: num(r.claims), reclaims: num(r.reclaims), active: num(r.activeCount),
    droppedWei: big(r.droppedWei), claimedWei: big(r.claimedWei), reclaimedWei: big(r.reclaimedWei),
    activeWei: big(r.activeWei), updatedAt: num(r.updatedAt),
  };
  if (Object.values(t).some((v) => v === null)) return null;
  const ok = t as { [K in keyof typeof t]: NonNullable<(typeof t)[K]> };
  // The totals must add up; if they don't, don't show them.
  if (ok.claims + ok.reclaims + ok.active !== ok.drops) return null;
  if (ok.claimedWei + ok.reclaimedWei + ok.activeWei !== ok.droppedWei) return null;
  return ok;
}

/** DailyStats rows → by UTC day. Malformed rows are dropped. */
export function parseDays(raw: unknown): Map<string, DayTotals> {
  const out = new Map<string, DayTotals>();
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    const r = (row ?? {}) as Record<string, unknown>;
    const dayN = typeof r.day === "number" && Number.isInteger(r.day) ? r.day : null;
    const drops = num(r.drops), claims = num(r.claims);
    const droppedWei = big(r.droppedWei), claimedWei = big(r.claimedWei);
    if (dayN === null || drops === null || claims === null || droppedWei === null || claimedWei === null) continue;
    const day = isoDayOf(dayN);
    out.set(day, { day, drops, claims, droppedWei, claimedWei });
  }
  return out;
}

const QUERY = `query Totals($from: Int!) {
  globalStats(id: "global") {
    drops claims reclaims droppedWei claimedWei reclaimedWei activeCount activeWei updatedAt
  }
  dailyStats_collection(where: { day_gte: $from }, orderBy: day, orderDirection: asc, first: 100) {
    day drops claims droppedWei claimedWei
  }
}`;

/**
 * The running totals and the last DAYS_BACK days, cached 30 s per server. Short
 * timeout: this runs alongside the page's other work and must never slow it.
 */
// After a failure, don't ask again for a minute: if the app points at an older
// version without totals, every page build would otherwise retry (and log) a
// query that can't succeed.
const RETRY_AFTER_MS = 60_000;
let unavailableUntil = 0;

export async function fetchIndexerSnapshot(nowMs = Date.now()): Promise<IndexerSnapshot | null> {
  if (Date.now() < unavailableUntil) return null;
  try {
    return await memo("indexer:totals", 30_000, async () => {
      const today = Math.floor(nowMs / 1000 / SECONDS_PER_DAY);
      const data = await gql<{ globalStats: unknown; dailyStats_collection: unknown }>(
        QUERY, { from: today - (DAYS_BACK - 1) }, { timeoutMs: 5_000, retries: 1 },
      );
      const totals = parseTotals(data.globalStats);
      if (!totals) throw new Error("running totals missing or inconsistent");
      return { totals, days: parseDays(data.dailyStats_collection) };
    });
  } catch (e) {
    unavailableUntil = Date.now() + RETRY_AFTER_MS;
    console.warn("[indexerTotals] unavailable for now, using the drop mirror:", (e as Error).message);
    return null;
  }
}
