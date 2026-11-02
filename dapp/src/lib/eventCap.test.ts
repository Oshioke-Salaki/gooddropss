import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Redis } from "@upstash/redis";
import { eventSlot } from "./eventCap";
import type { GdEvent } from "./events";

// Just enough of a sorted set for eventSlot.
function fakeRedis() {
  const z = new Map<string, Map<string, number>>();
  const get = (k: string) => { let m = z.get(k); if (!m) { m = new Map(); z.set(k, m); } return m; };
  return {
    z,
    async zrange(k: string) { return [...get(k).entries()].sort((a, b) => a[1] - b[1]).flatMap(([m, s]) => [m, s]); },
    async zadd(k: string, { score, member }: { score: number; member: string }) { get(k).set(member, score); return 1; },
    async zrem(k: string, m: string) { return get(k).delete(m) ? 1 : 0; },
    async zcard(k: string) { return get(k).size; },
    async expire() { return 1; },
  };
}

const E = { id: "evt123abc", title: "Campus Hunt", perPerson: 2, endsAt: 2_000_000_000 } as GdEvent;
const ME = "0xroot";
const T0 = 1_800_000_000;

describe("event per-person limit", () => {
  let r: ReturnType<typeof fakeRedis>;
  let chain: Record<string, { claimed: boolean; claimer: string }>;
  const opts = (reserve: boolean) => ({
    reserve,
    readDrop: async (id: string) => { if (!chain[id]) throw new Error("rpc"); return chain[id]; },
    rootOf: async (a: string) => (a === "0xmywallet" ? ME : a),
  });
  const slot = (id: string, reserve = true) => eventSlot(r as unknown as Redis, E, ME, id, opts(reserve));

  beforeEach(() => { r = fakeRedis(); chain = {}; vi.useFakeTimers(); vi.setSystemTime(T0 * 1000); });
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit, then refuses", async () => {
    expect(await slot("1")).toBeNull();
    expect(await slot("2")).toBeNull();
    expect(await slot("3")).toMatch(/limit of 2 drops per person at Campus Hunt/);
  });
  it("lets a person retry a drop they already hold", async () => {
    await slot("1"); await slot("2");
    expect(await slot("2")).toBeNull();
  });
  it("a check alone never takes a slot", async () => {
    expect(await slot("1", false)).toBeNull();
    expect(await slot("2", false)).toBeNull();
    expect(await r.zcard(`gd:event:found:${E.id}:${ME}`)).toBe(0);
  });
  it("gives back slots for proofs that were never used", async () => {
    await slot("1"); await slot("2");
    vi.setSystemTime((T0 + 600) * 1000);
    chain = { "1": { claimed: false, claimer: "0x0" }, "2": { claimed: true, claimer: "0xmywallet" } };
    expect(await slot("3")).toBeNull();          // 1 released, 2 kept
    expect(await slot("4")).toMatch(/limit/);
  });
  it("releases a drop someone else claimed, keeps it when unsure", async () => {
    await slot("1"); await slot("2");
    vi.setSystemTime((T0 + 600) * 1000);
    chain = { "1": { claimed: true, claimer: "0xsomeoneelse" } }; // "2" read fails
    expect(await slot("3")).toBeNull();
    expect(await slot("4")).toMatch(/limit/);
  });
  it("no limit means no bookkeeping", async () => {
    const open = { ...E, perPerson: 0 } as GdEvent;
    for (let i = 0; i < 20; i++) expect(await eventSlot(r as unknown as Redis, open, ME, String(i), opts(true))).toBeNull();
    expect(r.z.size).toBe(0);
  });
  it("matches the claim screen's wording", async () => {
    const { friendlyClaimError, eventLockTitle } = await import("./claimErrors");
    await slot("1"); await slot("2");
    const msg = (await slot("3"))!;
    const fe = friendlyClaimError(new Error(msg));
    expect(fe.kind).toBe("event");
    expect(fe.message).toBe(msg);
    expect(eventLockTitle(msg, null)).toBe("You've hit this event's limit");
    expect(friendlyClaimError(new Error("The hunt at Campus Hunt has ended.")).kind).toBe("event");
    expect(friendlyClaimError(new Error("Campus Hunt was taken down, so its drops stay locked.")).kind).toBe("event");
  });
});
