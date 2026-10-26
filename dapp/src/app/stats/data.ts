// Server-only (reads Redis and the subgraph).
import { fetchAllDrops } from "@/lib/subgraph";
import { resolveRoots } from "@/lib/roots";
import { memo } from "@/lib/serverCache";
import { buildBoard } from "@/lib/board";
import { getRedis, keys } from "@/lib/redis";
import { getEvents, statsFor } from "@/lib/eventStore";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface PublicStats {
  drops: number;
  claims: number;
  /** Whole G$. */
  droppedG: number;
  claimedG: number;
  hunters: number;
  droppers: number;
  events: { hosted: number; claimedG: number } | null;
  topHunters: { address: string; g: number; count: number }[];
  topDroppers: { address: string; g: number; count: number }[];
  /** Unix ms the numbers were computed. */
  at: number;
}

const whole = (wei: bigint) => Number(wei / 10n ** 18n);

/**
 * Everything the public /stats page shows, from the chain (via the subgraph),
 * grouped by GoodDollar identity so one person with two wallets counts once.
 * Built at most once a minute per server instance; the page and the API share
 * it, and the CDN sits in front of both.
 */
export function getPublicStats(): Promise<PublicStats> {
  return memo("public-stats", 60_000, async () => {
    const drops = await fetchAllDrops();
    const addrs = new Set<string>();
    for (const d of drops) {
      addrs.add(d.dropper.toLowerCase());
      if (d.claimer !== ZERO) addrs.add(d.claimer.toLowerCase());
    }
    const board = buildBoard(drops, await resolveRoots([...addrs]));
    const top = (rs: typeof board.hunters) => rs.slice(0, 10).map((r) => ({ address: r.address, g: whole(r.totalWei), count: r.count }));

    return {
      drops: board.totalDrops,
      claims: board.totalClaims,
      droppedG: whole(board.droppedWei),
      claimedG: whole(board.claimedWei),
      hunters: board.hunters.length,
      droppers: board.droppers.length,
      events: await eventTotals(),
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
