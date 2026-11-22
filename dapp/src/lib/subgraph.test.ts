import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Drop } from "@/types";

// lib/subgraph answers from the mirror when it's loaded, and otherwise waits
// briefly before falling back to a small direct query. Both sides are mocked.

const mirror = { ready: false, drops: [] as Drop[], load: vi.fn<() => Promise<Drop[]>>() };
vi.mock("@/lib/dropMirror", () => ({
  mirrorReady: () => mirror.ready,
  mirrorDrops: () => mirror.load(),
  mirrorPeek: (id: string) => (mirror.ready ? mirror.drops.find((d) => d.id.toString() === id) : undefined),
  toDrop: (r: { dropId: string; dropper: string; claimer: string; status: number; amount: string; expiry: string; claimedAt: string; createdAt: string }) => ({
    id: BigInt(r.dropId), dropper: r.dropper, claimer: r.claimer, status: r.status, amount: BigInt(r.amount),
    expiry: Number(r.expiry), claimedAt: Number(r.claimedAt), createdAt: Number(r.createdAt), lat: 0, lng: 0, hint: "",
  }),
}));
const gqlMock = vi.fn();
vi.mock("@/lib/subgraphClient", () => ({ gql: (...a: unknown[]) => gqlMock(...a) }));
vi.mock("@/lib/roots", () => ({ resolveRoots: async (a: string[]) => new Map(a.map((x) => [x, x])) }));

const ME = "0x00000000000000000000000000000000000000aa";
const YOU = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";
const drop = (id: number, over: Partial<Drop> = {}): Drop => ({
  id: BigInt(id), dropper: ME, amount: 10n, claimer: ZERO, expiry: 2_000_000_000, claimedAt: 0,
  createdAt: 1_700_000_000 + id, status: 0, lat: 0, lng: 0, hint: "", ...over,
});

let sg: typeof import("@/lib/subgraph");
beforeEach(async () => {
  vi.resetModules();
  mirror.ready = false;
  mirror.drops = [];
  mirror.load.mockReset();
  gqlMock.mockReset();
  sg = await import("@/lib/subgraph");
});
afterEach(() => vi.useRealTimers());

describe("quick reads", () => {
  it("use the mirror when it's loaded (no direct query)", async () => {
    mirror.ready = true;
    mirror.drops = [drop(1), drop(2, { status: 1, claimer: YOU, claimedAt: 5 }), drop(3, { expiry: 1 })];
    mirror.load.mockResolvedValue(mirror.drops);
    const live = await sg.fetchLiveDrops(1_000_000_000);
    expect(live.map((d) => d.id)).toEqual([1n]);
    expect(await sg.fetchHasActivity(YOU)).toBe(true);
    expect(gqlMock).not.toHaveBeenCalled();
  });

  it("cold: answer from the mirror when it loads first", async () => {
    mirror.load.mockImplementation(async () => [drop(1)]);
    gqlMock.mockImplementation(() => new Promise(() => {})); // direct query slow
    expect((await sg.fetchLiveDrops(1)).map((d) => d.id)).toEqual([1n]);
  });

  it("cold: answer from the direct query when the mirror is slow (never hang)", async () => {
    mirror.load.mockImplementation(() => new Promise(() => {})); // never resolves
    gqlMock.mockResolvedValue({ drops: [{ dropId: "9", dropper: ME, claimer: ZERO, status: 0, amount: "1", expiry: "2000000000", claimedAt: "0", createdAt: "1" }] });
    expect((await sg.fetchLiveDrops(1)).map((d) => d.id)).toEqual([9n]);
    expect(mirror.load).toHaveBeenCalledTimes(1); // the mirror still starts loading for later
  });

  it("fall back to the direct query when the mirror fails", async () => {
    mirror.load.mockRejectedValue(new Error("down"));
    gqlMock.mockResolvedValue({ claimed: [], created: [{ id: "1" }] });
    expect(await sg.fetchHasActivity(ME)).toBe(true);
  });

  it("fetchHasActivity throws when nothing answers (an outage is never 'no activity')", async () => {
    mirror.load.mockRejectedValue(new Error("down"));
    gqlMock.mockRejectedValue(new Error("down too"));
    await expect(sg.fetchHasActivity(ME)).rejects.toThrow();
  });

  it("fetchHasActivity ignores a drop the wallet was only assigned, not claimed", async () => {
    mirror.ready = true;
    mirror.drops = [drop(1, { dropper: YOU, claimer: ME, status: 2 })];
    mirror.load.mockResolvedValue(mirror.drops);
    expect(await sg.fetchHasActivity(ME)).toBe(false);
  });

  it("fetchFirstActivityAt is the earliest claim or drop across all wallets", async () => {
    mirror.ready = true;
    mirror.drops = [
      drop(1, { dropper: YOU, createdAt: 500 }),
      drop(2, { dropper: YOU, status: 1, claimer: ME, claimedAt: 300 }),
      drop(3, { dropper: ME, createdAt: 400 }),
    ];
    mirror.load.mockResolvedValue(mirror.drops);
    expect(await sg.fetchFirstActivityAt([ME])).toBe(300);
    expect(await sg.fetchFirstActivityAt(["0x00000000000000000000000000000000000000cc"])).toBeNull();
    expect(await sg.fetchFirstActivityAt(["not-an-address"])).toBeNull();
  });

  it("fetchDropsForAddress merges several wallets, newest first, without duplicates", async () => {
    mirror.ready = true;
    mirror.drops = [drop(1, { createdAt: 10 }), drop(2, { dropper: YOU, claimer: ME, status: 1, createdAt: 30 }), drop(3, { dropper: YOU, createdAt: 20 })];
    mirror.load.mockResolvedValue(mirror.drops);
    expect((await sg.fetchDropsForAddress([ME, ME.toUpperCase()])).map((d) => d.id)).toEqual([2n, 1n]);
    expect((await sg.fetchDropsForAddress([ME, YOU])).map((d) => d.id)).toEqual([2n, 3n, 1n]);
  });

  it("fetchRecentActivity lists the newest drops and finds, newest first", async () => {
    mirror.ready = true;
    mirror.drops = [drop(1, { createdAt: 100 }), drop(2, { createdAt: 200, status: 1, claimer: YOU, claimedAt: 300 })];
    mirror.load.mockResolvedValue(mirror.drops);
    const items = await sg.fetchRecentActivity();
    expect(items.map((i) => `${i.type}:${i.timestamp}`)).toEqual(["claim:300", "drop:200", "drop:100"]);
  });

  it("fetchRecentActivity returns [] rather than throwing", async () => {
    mirror.load.mockRejectedValue(new Error("down"));
    gqlMock.mockRejectedValue(new Error("down"));
    await expect(sg.fetchRecentActivity()).resolves.toEqual([]);
  });
});

describe("single drops", () => {
  it("come from the mirror when loaded, else one primary-key lookup", async () => {
    mirror.ready = true;
    mirror.drops = [drop(5)];
    expect((await sg.fetchDropById("5"))?.id).toBe(5n);
    expect(gqlMock).not.toHaveBeenCalled();

    mirror.ready = false;
    gqlMock.mockResolvedValue({ drop: null });
    expect(await sg.fetchDropById("6")).toBeNull();
    expect(gqlMock.mock.calls[0][1]).toEqual({ id: "6" });
  });

  it("reject malformed ids without a request; fetchDropByDropId never throws", async () => {
    expect(await sg.fetchDropById("1; drop table")).toBeNull();
    gqlMock.mockRejectedValue(new Error("down"));
    await expect(sg.fetchDropByDropId("7")).resolves.toBeNull();
  });
});

describe("hunter profile", () => {
  it("is identity-scoped and shared for 30 s per address", async () => {
    mirror.ready = true;
    mirror.drops = [drop(1), drop(2, { dropper: YOU, status: 1, claimer: ME, claimedAt: 5 })];
    mirror.load.mockResolvedValue(mirror.drops);
    const a = await sg.fetchHunterProfile(ME);
    const b = await sg.fetchHunterProfile(ME);
    expect(a?.dropsCreated.map((d) => d.id)).toEqual([1n]);
    expect(a?.dropsClaimed.map((d) => d.id)).toEqual([2n]);
    expect(mirror.load).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("returns null when drops can't be loaded", async () => {
    mirror.load.mockRejectedValue(new Error("down"));
    expect(await sg.fetchHunterProfile(ME)).toBeNull();
  });
});
