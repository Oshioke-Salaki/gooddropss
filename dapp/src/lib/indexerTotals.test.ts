import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDays, parseTotals, isoDayOf } from "./indexerTotals";

const E18 = 10n ** 18n;
const RAW = {
  drops: "10", claims: "6", reclaims: "1", activeCount: "3",
  droppedWei: (1000n * E18).toString(), claimedWei: (600n * E18).toString(),
  reclaimedWei: (100n * E18).toString(), activeWei: (300n * E18).toString(),
  updatedAt: "1795426932",
};

describe("parseTotals", () => {
  it("reads a well-formed row into numbers and bigints", () => {
    expect(parseTotals(RAW)).toEqual({
      drops: 10, claims: 6, reclaims: 1, active: 3,
      droppedWei: 1000n * E18, claimedWei: 600n * E18, reclaimedWei: 100n * E18, activeWei: 300n * E18,
      updatedAt: 1795426932,
    });
  });

  it("rejects missing, malformed or negative values", () => {
    expect(parseTotals(null)).toBeNull();
    expect(parseTotals({ ...RAW, claims: undefined })).toBeNull();
    expect(parseTotals({ ...RAW, droppedWei: "12.5" })).toBeNull();
    expect(parseTotals({ ...RAW, activeCount: "-1" })).toBeNull();
    expect(parseTotals({ ...RAW, drops: 10 })).toBeNull();     // numbers arrive as strings
  });

  it("rejects totals that don't add up, rather than showing them", () => {
    expect(parseTotals({ ...RAW, drops: "11" })).toBeNull();
    expect(parseTotals({ ...RAW, activeWei: (301n * E18).toString() })).toBeNull();
  });
});

describe("parseDays", () => {
  it("keys rows by UTC day and skips malformed ones", () => {
    const day = 20780;
    const m = parseDays([
      { day, drops: "5", claims: "2", droppedWei: "50", claimedWei: "20" },
      { day: "bad", drops: "1", claims: "1", droppedWei: "1", claimedWei: "1" },
      { day: day + 1, drops: "x", claims: "1", droppedWei: "1", claimedWei: "1" },
      null,
    ]);
    expect([...m.keys()]).toEqual([isoDayOf(day)]);
    expect(m.get(isoDayOf(day))).toEqual({ day: isoDayOf(day), drops: 5, claims: 2, droppedWei: 50n, claimedWei: 20n });
    expect(parseDays(undefined).size).toBe(0);
  });

  it("day numbers map to the UTC date the indexer bucketed them under", () => {
    expect(isoDayOf(0)).toBe("1970-01-01");
    expect(isoDayOf(Math.floor(Date.UTC(2026, 10, 23, 23, 59) / 86_400_000))).toBe("2026-11-23");
  });
});

describe("fetchIndexerSnapshot", () => {
  beforeEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  it("returns the totals and recent days from one query", async () => {
    vi.doMock("@/lib/subgraphClient", () => ({
      gql: vi.fn(async () => ({ globalStats: RAW, dailyStats_collection: [{ day: 20780, drops: "5", claims: "2", droppedWei: "50", claimedWei: "20" }] })),
    }));
    const { fetchIndexerSnapshot } = await import("./indexerTotals");
    const s = await fetchIndexerSnapshot();
    expect(s?.totals.drops).toBe(10);
    expect(s?.days.size).toBe(1);
  });

  it("returns null (never throws) when the indexer has no totals, then waits before asking again", async () => {
    const gql = vi.fn(async () => { throw new Error("Type `Query` has no field `globalStats`"); });
    vi.doMock("@/lib/subgraphClient", () => ({ gql }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchIndexerSnapshot } = await import("./indexerTotals");
    expect(await fetchIndexerSnapshot()).toBeNull();
    expect(await fetchIndexerSnapshot()).toBeNull();
    expect(gql).toHaveBeenCalledTimes(1);
  });

  it("returns null when the totals are inconsistent", async () => {
    vi.doMock("@/lib/subgraphClient", () => ({ gql: vi.fn(async () => ({ globalStats: { ...RAW, drops: "99" }, dailyStats_collection: [] })) }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchIndexerSnapshot } = await import("./indexerTotals");
    expect(await fetchIndexerSnapshot()).toBeNull();
  });
});
