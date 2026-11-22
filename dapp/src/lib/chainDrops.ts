// The contract as the source of truth when the indexer can't be trusted.
//
// The subgraph can fall behind (it was paused for a day when Goldsky's Starter
// limits ran out). While it's behind, the map would show chests that were already
// found and miss new ones. These helpers measure how far behind it is and read
// the few drops that matter straight from the contract (one multicall).

import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { publicClient } from "@/lib/publicClient";
import { memo } from "@/lib/serverCache";
import { mirrorInfo } from "@/lib/dropMirror";
import { gql } from "@/lib/subgraphClient";
import type { Drop } from "@/types";

/** Celo makes a block about every second: 300 blocks ≈ 5 minutes behind. */
export const STALE_BLOCKS = 300;
const ZERO = /^0x0{40}$/i;
/** Never read more than this many new drops from the chain in one go. */
const MAX_NEW = 500;
const CHUNK = 100;

export interface IndexerLag {
  indexedBlock: number;
  headBlock: number;
  behind: number;
  stale: boolean;
}

/** How far the subgraph is behind the chain. Cached 15 s; throws if neither answers. */
export function indexerLag(): Promise<IndexerLag> {
  return memo("indexer-lag", 15_000, async () => {
    const info = mirrorInfo();
    const [head, indexed] = await Promise.all([
      publicClient.getBlockNumber({ cacheTime: 5_000 }),
      info && Date.now() - info.syncedAt < 30_000
        ? Promise.resolve(info.block)
        : gql<{ _meta: { block: { number: number } } }>("{ _meta { block { number } } }", {}, { timeoutMs: 6_000, retries: 1 })
            .then((m) => m._meta.block.number),
    ]);
    const behind = Math.max(0, Number(head) - indexed);
    return { indexedBlock: indexed, headBlock: Number(head), behind, stale: behind > STALE_BLOCKS };
  });
}

// A drop seen only on the chain has no creation time there; remember when we
// first saw it so it stays stable between reads.
const firstSeen = new Map<string, number>();
function seenAt(id: string): number {
  let t = firstSeen.get(id);
  if (t === undefined) {
    t = Math.floor(Date.now() / 1000);
    if (firstSeen.size > 5_000) firstSeen.clear();
    firstSeen.set(id, t);
  }
  return t;
}

type ChainDrop = {
  dropper: `0x${string}`; amount: bigint; claimer: `0x${string}`; expiry: number | bigint;
  claimedAt: number | bigint; status: number; lat: number; lng: number; hint: string;
};

/**
 * Read drops from the contract. `known` supplies the creation time for drops the
 * indexer already has. Unknown ids (all-zero) and failed reads are left out.
 */
export async function readDropsFromChain(ids: bigint[], known?: (id: string) => Drop | undefined): Promise<Drop[]> {
  const out: Drop[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await publicClient.multicall({
      contracts: chunk.map((id) => ({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop" as const, args: [id] as const })),
      allowFailure: true,
    });
    res.forEach((r, j) => {
      if (r.status !== "success") return;
      const c = r.result as unknown as ChainDrop;
      if (ZERO.test(c.dropper)) return;
      const id = chunk[j];
      const key = id.toString();
      out.push({
        id,
        dropper: c.dropper,
        amount: BigInt(c.amount),
        claimer: c.claimer,
        expiry: Number(c.expiry),
        claimedAt: Number(c.claimedAt),
        createdAt: known?.(key)?.createdAt || seenAt(key),
        status: Number(c.status),
        lat: Number(c.lat),
        lng: Number(c.lng),
        hint: c.hint,
      });
    });
  }
  return out;
}

/** One drop straight from the contract, or null if it doesn't exist. */
export async function readDropFromChain(id: bigint, known?: Drop): Promise<Drop | null> {
  const [d] = await readDropsFromChain([id], () => known);
  return d ?? null;
}

/**
 * The live set corrected from the chain, for when the indexer is behind:
 * re-reads every drop the indexer thinks is live (some were found or reclaimed
 * since) and adds drops created after the last one it knows.
 */
export async function patchLiveFromChain(indexedLive: Drop[], all: { maxId: bigint; peek: (id: string) => Drop | undefined }): Promise<Drop[]> {
  const count = await publicClient.readContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "dropCount" }) as bigint;
  const ids = new Set<bigint>(indexedLive.map((d) => d.id));
  const from = all.maxId + 1n > count - BigInt(MAX_NEW) + 1n ? all.maxId + 1n : count - BigInt(MAX_NEW) + 1n;
  for (let id = from; id <= count; id++) ids.add(id);
  const fresh = await readDropsFromChain([...ids], all.peek);
  const now = Math.floor(Date.now() / 1000);
  return fresh.filter((d) => d.status === 0 && d.expiry > now);
}
