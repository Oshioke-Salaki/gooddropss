import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Drop } from "@/types";

const ZERO = "0x0000000000000000000000000000000000000000";
const A = "0x00000000000000000000000000000000000000aa";

/** The fake contract: drop id → its on-chain struct. */
const chain = new Map<bigint, Partial<Drop>>();
let dropCount = 0n;
let head = 1_000n;
type CallResult = { status: "success" | "failure"; result?: unknown };
const multicall = vi.fn(async ({ contracts }: { contracts: { args: [bigint] }[] }): Promise<CallResult[]> =>
  contracts.map(({ args: [id] }) => {
    const d = chain.get(id);
    return {
      status: "success" as const,
      result: d
        ? { dropper: A, amount: 5n, claimer: ZERO, expiry: 2_000_000_000, claimedAt: 0, status: 0, lat: 1, lng: 2, hint: "", ...d }
        : { dropper: ZERO, amount: 0n, claimer: ZERO, expiry: 0, claimedAt: 0, status: 0, lat: 0, lng: 0, hint: "" },
    };
  }));
vi.mock("@/lib/publicClient", () => ({
  publicClient: {
    multicall: (a: never) => multicall(a),
    readContract: async () => dropCount,
    getBlockNumber: async () => head,
  },
}));
let indexed = 990;
vi.mock("@/lib/subgraphClient", () => ({ gql: async () => ({ _meta: { block: { number: indexed } } }) }));
vi.mock("@/lib/dropMirror", () => ({ mirrorInfo: () => null }));

const d = (id: number, over: Partial<Drop> = {}): Drop => ({
  id: BigInt(id), dropper: A, amount: 5n, claimer: ZERO, expiry: 2_000_000_000, claimedAt: 0,
  createdAt: 1_700_000_000, status: 0, lat: 1, lng: 2, hint: "", ...over,
});

let cd: typeof import("@/lib/chainDrops");
beforeEach(async () => {
  vi.resetModules();
  chain.clear();
  multicall.mockClear();
  dropCount = 0n;
  head = 1_000n;
  indexed = 990;
  cd = await import("@/lib/chainDrops");
});

describe("indexerLag", () => {
  it("is fine when the indexer is within ~5 minutes", async () => {
    expect(await cd.indexerLag()).toMatchObject({ behind: 10, stale: false });
  });
  it("flags a stalled indexer", async () => {
    indexed = 100;
    expect(await cd.indexerLag()).toMatchObject({ behind: 900, stale: true });
  });
});

describe("patchLiveFromChain", () => {
  it("drops found chests, keeps live ones, adds new ones, keeps creation times", async () => {
    chain.set(1n, {});                                // still live
    chain.set(2n, { status: 1, claimer: A });         // found since the indexer stalled
    chain.set(3n, { expiry: 10 });                    // expired
    chain.set(4n, {});                                // created after the stall
    dropCount = 4n;
    const known = [d(1, { createdAt: 111 }), d(2), d(3)];
    const live = await cd.patchLiveFromChain(known, { maxId: 3n, peek: (id) => known.find((k) => k.id.toString() === id) });
    expect(live.map((x) => x.id)).toEqual([1n, 4n]);
    expect(live[0].createdAt).toBe(111);
    expect(live[1].createdAt).toBeGreaterThan(0); // first seen now: stable, not 0
  });

  it("reads at most the newest 500 unknown drops, in chunks", async () => {
    dropCount = 2_000n;
    for (let i = 1n; i <= 2_000n; i++) chain.set(i, {});
    const live = await cd.patchLiveFromChain([], { maxId: 0n, peek: () => undefined });
    expect(live).toHaveLength(500);
    expect(live[0].id).toBe(1_501n);
    expect(multicall).toHaveBeenCalledTimes(5); // 100 per call
  });

  it("skips ids the contract doesn't know (all-zero) and failed reads", async () => {
    multicall.mockImplementationOnce(async () => [
      { status: "failure" },
      { status: "success", result: { dropper: ZERO } },
    ]);
    expect(await cd.readDropsFromChain([1n, 2n])).toEqual([]);
  });
});
