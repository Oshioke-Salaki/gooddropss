import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ keys: {} }));
vi.mock("@/lib/identityRoot", () => ({ resolveIdentityRoot: async (a: string) => a }));
vi.mock("@/lib/subgraph", () => ({ fetchDropsForAddress: async () => [] }));

import { windowActivity } from "@/lib/weekActivity";
import type { Drop } from "@/types";
import type { WeekBounds } from "@/lib/quests";

const ME = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";
const week: WeekBounds = { index: 0, start: 1_000, end: 2_000 };
const d = (id: number, over: Partial<Drop>): Drop => ({
  id: BigInt(id), dropper: OTHER, amount: 1n, claimer: ZERO, expiry: 0, claimedAt: 0, createdAt: 0, status: 0, lat: 0, lng: 0, hint: "", ...over,
});

describe("windowActivity", () => {
  it("counts claims and drops with timestamps in [start, end), for any of the wallets", () => {
    const drops = [
      d(1, { status: 1, claimer: ME, claimedAt: 1_000 }),          // start: in
      d(2, { status: 1, claimer: ME, claimedAt: 2_000 }),          // end: out
      d(3, { status: 1, claimer: `0x${ME.slice(2).toUpperCase()}`, claimedAt: 1_500 }), // case-insensitive
      d(4, { status: 2, claimer: ME, claimedAt: 1_500 }),          // not a claim
      d(5, { dropper: ME, createdAt: 1_999 }),                     // created: in
      d(6, { dropper: ME, createdAt: 999 }),                       // created: out
      d(7, { status: 1, claimer: OTHER, claimedAt: 1_500 }),       // someone else
    ];
    const r = windowActivity(drops, [ME], week);
    expect(r.claimed.map((x) => x.id)).toEqual([1n, 3n]);
    expect(r.created.map((x) => x.id)).toEqual([5n]);
  });
});
