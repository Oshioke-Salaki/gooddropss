import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { parseDropHint } from "@/lib/utils";
import type { TaskDropRecord } from "@/lib/taskShared";

// Server-only. The rewards a customer can earn at a shop right now, so the
// shop sheet and the payment receipt can put the reward code in front of them
// without a trip back to the map.

export interface LiveReward {
  dropId: string;
  task: string;
  amountWei: string;
  /** Unix seconds. */
  expiry: number;
}

export interface ChainReward { status: number; expiry: number; amount: bigint; hint: string }

/** How many of a shop's newest rewards are considered (matches /api/task/list). */
export const REWARDS_SCAN = 100;

/**
 * A shop's rewards that are funded, unexpired, really tagged for this shop
 * on-chain, and not held for a different customer. Soonest-expiring first, so
 * the reward closest to running out is used before newer ones.
 */
export async function liveRewards(
  redis: Redis,
  spotId: string,
  args: {
    /** On-chain drops for these ids, same order; null where the read failed. */
    readDrops: (dropIds: string[]) => Promise<(ChainReward | null)[]>;
    /** The customer's identity root; rewards held for anyone else are left out. */
    root?: string | null;
    now?: number;
  },
): Promise<LiveReward[]> {
  // Upstash turns number-like strings into numbers on read ("11247" → 11247),
  // so ids are normalized back to strings before anything else touches them.
  const ids = ((await redis.lrange<string | number>(keys.taskDropsBySpot(spotId), 0, REWARDS_SCAN - 1)) ?? []).map(String);
  const unique = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  if (unique.length === 0) return [];

  const [recs, held, chain] = await Promise.all([
    redis.mget<(TaskDropRecord | null)[]>(...unique.map((id) => keys.taskDrop(id))),
    redis.mget<(string | null)[]>(...unique.map((id) => keys.taskReserved(id))),
    args.readDrops(unique),
  ]);

  const now = args.now ?? Math.floor(Date.now() / 1000);
  const me = args.root?.toLowerCase() ?? null;
  const out: LiveReward[] = [];
  unique.forEach((dropId, i) => {
    const rec = recs[i];
    const d = chain[i];
    if (!rec || rec.spotId !== spotId || !d) return;
    if (d.status !== 0 || d.expiry <= now) return;
    if (parseDropHint(d.hint).taskMerchantId !== spotId) return;
    const holder = held[i];
    if (holder && holder !== me) return;
    out.push({ dropId, task: rec.task, amountWei: d.amount.toString(), expiry: d.expiry });
  });
  return out.sort((a, b) => a.expiry - b.expiry || Number(BigInt(a.dropId) - BigInt(b.dropId)));
}
