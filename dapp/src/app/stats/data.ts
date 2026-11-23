// Server-only (reads Redis and the subgraph).
import { memo } from "@/lib/serverCache";
import { getBoardSnapshot } from "@/lib/boardSnapshot";
import { getRedis, keys } from "@/lib/redis";
import { getEvents, statsFor } from "@/lib/eventStore";
import { circulatedG } from "@/lib/circulation";
import { fetchIndexerSnapshot } from "@/lib/indexerTotals";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface PublicStats {
  drops: number;
  claims: number;
  /** Whole G$. */
  droppedG: number;
  claimedG: number;
  /** The headline: see lib/circulation. */
  circulatedG: number;
  hunters: number;
  droppers: number;
  /** Everyone who hid or found G$, one per person (a hunter who also drops counts once). */
  users: number;
  events: { hosted: number; claimedG: number } | null;
  topHunters: { address: string; g: number; count: number }[];
  topDroppers: { address: string; g: number; count: number }[];
  /** Unix ms the numbers were computed. */
  at: number;
}

const whole = (wei: bigint) => Number(wei / 10n ** 18n);

/**
 * Everything the public /stats page shows, from the chain (via the subgraph).
 * Drop and G$ totals come from the indexer's running totals (exact, one small
 * query); people counts and the top lists are grouped by GoodDollar identity
 * from the drop mirror, so one person with two wallets counts once. If the
 * running totals can't be read, the mirror supplies the totals too.
 * Built at most once a minute per server instance; the page and the API share
 * it, and the CDN sits in front of both.
 */
export function getPublicStats(): Promise<PublicStats> {
  return memo("public-stats", 60_000, async () => {
    // The same leaderboard /api/board serves (built once, shared).
    const [{ drops, roots, board }, idx, events] = await Promise.all([
      getBoardSnapshot(), fetchIndexerSnapshot(), eventTotals(),
    ]);
    const t = idx?.totals;
    const droppedWei = t?.droppedWei ?? board.droppedWei;
    const claimedWei = t?.claimedWei ?? board.claimedWei;
    // Total users, by identity: a hunter who also drops, or one person on two
    // wallets, counts once. (The board's lists name each person by their latest
    // wallet, so merging those could count someone twice.)
    const rootOf = (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase();
    const people = new Set<string>();
    for (const d of drops) {
      people.add(rootOf(d.dropper));
      if (d.claimer !== ZERO && d.status === 1) people.add(rootOf(d.claimer));
    }
    const top = (rs: typeof board.hunters) => rs.slice(0, 10).map((r) => ({ address: r.address, g: whole(r.totalWei), count: r.count }));

    return {
      drops: t?.drops ?? board.totalDrops,
      claims: t?.claims ?? board.totalClaims,
      droppedG: whole(droppedWei),
      claimedG: whole(claimedWei),
      circulatedG: circulatedG(whole(droppedWei)),
      hunters: board.hunters.length,
      droppers: board.droppers.length,
      users: people.size,
      events,
      topHunters: top(board.hunters),
      topDroppers: top(board.droppers),
      at: Date.now(),
    };
  });
}

/** Approved events that have started, and what was found at them. Null if unavailable. */
async function eventTotals(): Promise<PublicStats["events"]> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const now = Math.floor(Date.now() / 1000);
    const ids = await redis.zrange<string[]>(keys.eventsPublic(), 0, now, { byScore: true });
    const events = (await getEvents(redis, ids)).filter((e) => e.status === "approved");
    if (events.length === 0) return { hosted: 0, claimedG: 0 };
    const stats = await statsFor(events, now);
    // Summing per-event hunter counts would count a regular at three events
    // three times, so only totals that add up honestly are reported.
    let claimed = 0n;
    for (const s of stats.values()) claimed += s.claimedWei;
    return { hosted: events.length, claimedG: whole(claimed) };
  } catch {
    return null;
  }
}
