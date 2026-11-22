import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubgraphDrop } from "@/lib/dropMirror";

// The mirror talks to the subgraph only through gql(); a fake subgraph below
// answers it from an in-memory table, so these tests exercise the real paging,
// delta, rewind and failure logic.

const gqlMock = vi.fn();
vi.mock("@/lib/subgraphClient", () => ({ gql: (...a: unknown[]) => gqlMock(...a) }));
const redisStore = new Map<string, string>();
let redisOn = false;
vi.mock("@/lib/redis", () => ({
  getRedis: () => (redisOn ? {
    get: async (k: string) => redisStore.get(k) ?? null,
    set: async (k: string, v: string) => { redisStore.set(k, v); return "OK"; },
  } : null),
}));

const A = "0x00000000000000000000000000000000000000aa";
const ZERO = "0x0000000000000000000000000000000000000000";
function row(id: number, over: Partial<SubgraphDrop> = {}): SubgraphDrop {
  return {
    id: String(id), dropId: String(id), dropper: A, amount: "1000", claimer: ZERO, expiry: "9999999999",
    claimedAt: "0", createdAt: String(1_700_000_000 + id), status: 0, lat: 1, lng: 2, hint: `h${id}`, ...over,
  };
}

/** A fake subgraph: rows with the block they last changed at. */
const table = new Map<string, { row: SubgraphDrop; block: number }>();
let head = 100;
function serve(query: string, vars: { lastId: string; b?: number }) {
  const rows = [...table.values()]
    .filter((e) => (vars.b === undefined || !query.includes("_change_block") ? true : e.block >= vars.b))
    .map((e) => e.row)
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) // graph-node orders String ids lexically
    .filter((r) => r.id > vars.lastId)
    .slice(0, 1000);
  return { _meta: { block: { number: head } }, drops: rows };
}

async function fresh() {
  vi.resetModules();
  return import("@/lib/dropMirror");
}

beforeEach(() => {
  table.clear();
  redisStore.clear();
  redisOn = false;
  head = 100;
  gqlMock.mockReset();
  gqlMock.mockImplementation(async (q: string, v: { lastId: string; b?: number }) => serve(q, v));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("drop mirror", () => {
  it("loads every drop across pages, with string-id cursor paging", async () => {
    for (let i = 1; i <= 2500; i++) table.set(String(i), { row: row(i), block: 50 });
    const m = await fresh();
    const all = await m.mirrorDrops();
    expect(all).toHaveLength(2500);
    expect(new Set(all.map((d) => d.id.toString())).size).toBe(2500);
    expect(all[0].id).toBe(1n);
    expect(all[2499].id).toBe(2500n); // sorted numerically, not lexically
    expect(gqlMock).toHaveBeenCalledTimes(3); // 1000 + 1000 + 500
    expect(m.mirrorInfo()).toMatchObject({ maxId: 2500n, block: 100, size: 2500 });
  });

  it("serves reads from memory within the sync window (no requests)", async () => {
    table.set("1", { row: row(1), block: 10 });
    const m = await fresh();
    await m.mirrorDrops();
    gqlMock.mockClear();
    await m.mirrorDrops();
    await m.mirrorDrops();
    expect(gqlMock).not.toHaveBeenCalled();
  });

  it("refreshes with one change query and applies updates and new drops", async () => {
    table.set("1", { row: row(1), block: 10 });
    table.set("2", { row: row(2), block: 10 });
    const m = await fresh();
    await m.mirrorDrops();

    head = 120;
    table.set("2", { row: row(2, { status: 1, claimer: A, claimedAt: "1700000100" }), block: 110 });
    table.set("3", { row: row(3), block: 115 });
    gqlMock.mockClear();
    vi.advanceTimersByTime(11_000);
    const all = await m.mirrorDrops();

    expect(gqlMock).toHaveBeenCalledTimes(1);
    expect(gqlMock.mock.calls[0][0]).toContain("_change_block");
    expect(gqlMock.mock.calls[0][1]).toMatchObject({ b: 100 });
    expect(all.map((d) => [d.id, d.status])).toEqual([[1n, 0], [2n, 1], [3n, 0]]);
    expect(m.mirrorInfo()?.block).toBe(120);
  });

  it("shares one sync between concurrent callers", async () => {
    table.set("1", { row: row(1), block: 10 });
    const m = await fresh();
    await Promise.all([m.mirrorDrops(), m.mirrorDrops(), m.mirrorDrops()]);
    expect(gqlMock).toHaveBeenCalledTimes(1);
  });

  it("`fresh` re-syncs, but never more than once every 2 s", async () => {
    table.set("1", { row: row(1), block: 10 });
    const m = await fresh();
    await m.mirrorDrops();
    gqlMock.mockClear();
    await m.mirrorDrops({ fresh: true });
    expect(gqlMock).not.toHaveBeenCalled(); // synced < 2 s ago
    vi.advanceTimersByTime(2_500);
    await m.mirrorDrops({ fresh: true });
    expect(gqlMock).toHaveBeenCalledTimes(1);
  });

  it("serves the last good copy when a refresh fails", async () => {
    table.set("1", { row: row(1), block: 10 });
    const m = await fresh();
    await m.mirrorDrops();
    gqlMock.mockRejectedValueOnce(new Error("down"));
    vi.advanceTimersByTime(11_000);
    await expect(m.mirrorDrops()).resolves.toHaveLength(1);
  });

  it("throws when there's no copy yet and the subgraph is down", async () => {
    gqlMock.mockRejectedValue(new Error("down"));
    const m = await fresh();
    await expect(m.mirrorDrops()).rejects.toThrow("down");
    expect(m.mirrorReady()).toBe(false);
  });

  it("on a redeploy (block goes backwards) keeps serving, and rebuilds in the background", async () => {
    table.set("1", { row: row(1), block: 10 });
    head = 1_000;
    const m = await fresh();
    await m.mirrorDrops();
    head = 500; // a fresh deployment re-indexing from scratch
    table.clear();
    table.set("7", { row: row(7), block: 400 });
    vi.advanceTimersByTime(11_000);
    expect((await m.mirrorDrops()).map((d) => d.id)).toEqual([1n]); // no waiting
    await vi.waitFor(async () => {
      vi.advanceTimersByTime(11_000);
      expect((await m.mirrorDrops()).map((d) => d.id)).toEqual([7n]);
    });
  });

  it("does the hourly full reload in the background; the reader never waits for it", async () => {
    table.set("1", { row: row(1), block: 10 });
    const m = await fresh();
    await m.mirrorDrops();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    gqlMock.mockClear();
    gqlMock.mockImplementation(async (q: string, v: { lastId: string; b?: number }) => {
      if (!q.includes("_change_block")) await gate; // the full reload hangs
      return serve(q, v);
    });
    vi.advanceTimersByTime(61 * 60_000);
    await expect(m.mirrorDrops()).resolves.toHaveLength(1); // answered by the quick change query
    const queries = gqlMock.mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => q.includes("_change_block"))).toBe(true);
    expect(queries.some((q) => !q.includes("_change_block"))).toBe(true); // full reload started
    release();
  });

  it("starts a cold instance from a recent Redis snapshot plus one change query", async () => {
    redisOn = true;
    for (let i = 1; i <= 1500; i++) table.set(String(i), { row: row(i), block: 50 });
    const first = await fresh();
    await first.mirrorDrops();
    await vi.waitFor(() => expect(redisStore.size).toBe(1)); // the save is fire-and-forget

    const cold = await fresh(); // a new server instance
    gqlMock.mockClear();
    const all = await cold.mirrorDrops();
    expect(all).toHaveLength(1500);
    expect(gqlMock).toHaveBeenCalledTimes(1);
    expect(gqlMock.mock.calls[0][0]).toContain("_change_block");
  });

  it("uses a snapshot up to a day old (the change query catches it up), not older", async () => {
    redisOn = true;
    table.set("1", { row: row(1), block: 10 });
    const first = await fresh();
    await first.mirrorDrops();
    await vi.waitFor(() => expect(redisStore.size).toBe(1));

    vi.advanceTimersByTime(20 * 3600_000);
    table.set("2", { row: row(2), block: 150 }); head = 200;
    let cold = await fresh();
    gqlMock.mockClear();
    expect((await cold.mirrorDrops()).map((d) => d.id)).toEqual([1n, 2n]);
    expect(gqlMock.mock.calls[0][0]).toContain("_change_block");

    vi.advanceTimersByTime(5 * 3600_000); // now 25 h old
    cold = await fresh();
    gqlMock.mockClear();
    await cold.mirrorDrops();
    expect(gqlMock.mock.calls[0][0]).not.toContain("_change_block");
  });

  it("snapshot codec round-trips every field and stays well under 1 MB for 11k drops", async () => {
    const m = await fresh();
    const { toDrop, __snapshotCodec } = m;
    const drops = Array.from({ length: 11_000 }, (_, i) => toDrop(row(i + 1, {
      amount: "123456789012345678901", hint: "[E:abc123] Under the big mango tree by the gate", lat: -1234567, lng: 7654321,
    })));
    const enc = __snapshotCodec.encode(drops, 4242);
    expect(enc.length).toBeLessThan(1_000_000);
    const dec = __snapshotCodec.decode(enc)!;
    expect(dec.block).toBe(4242);
    expect(dec.byId.size).toBe(11_000);
    expect(dec.byId.get("5")).toEqual(drops[4]);
  });
});
