import { describe, it, expect, beforeEach } from "vitest";
import { liveRewards, type ChainReward } from "./taskRewards";
import { keys } from "./redis";
import { buildTaskHint } from "./utils";
import { fakeRedis, asRedis, type FakeRedis } from "@/test/fakeRedis";

const NOW = 1_800_000_000;
const hint = (spot: string) => buildTaskHint("Task at the shop", spot);

describe("liveRewards", () => {
  let r: FakeRedis;
  let chain: Record<string, ChainReward | null>;
  const run = (root: string | null = null) =>
    liveRewards(asRedis(r), "spot1", { root, now: NOW, readDrops: async (ids) => ids.map((id) => chain[id] ?? null) });
  const add = async (id: string, task: string, c: Partial<ChainReward> | null, spot = "spot1") => {
    await r.lpush(keys.taskDropsBySpot("spot1"), id);
    await r.set(keys.taskDrop(id), { spotId: spot, task, createdAt: NOW });
    chain[id] = c === null ? null : { status: 0, expiry: NOW + 3600, amount: 500n * 10n ** 18n, hint: hint("spot1"), ...c };
  };

  beforeEach(() => { r = fakeRedis(); chain = {}; });

  it("is empty for a shop with no rewards", async () => {
    expect(await run()).toEqual([]);
  });

  it("keeps only funded, unexpired rewards tagged for this shop, soonest-expiring first", async () => {
    await add("1", "Buy any coffee", { expiry: NOW + 7200 });
    await add("2", "Buy any coffee", { expiry: NOW + 600 });
    await add("3", "Claimed one", { status: 1 });
    await add("4", "Expired one", { expiry: NOW });
    await add("5", "Wrong tag", { hint: hint("spot2") });
    await add("6", "Other shop's record", {}, "spot2");
    await add("7", "Chain read failed", null);
    const out = await run();
    expect(out.map((x) => x.dropId)).toEqual(["2", "1"]);
    expect(out[0]).toEqual({ dropId: "2", task: "Buy any coffee", amountWei: (500n * 10n ** 18n).toString(), expiry: NOW + 600 });
  });

  it("hides a reward held for another customer, but not from the customer it's held for", async () => {
    await add("1", "Buy any coffee", {});
    await r.set(keys.taskReserved("1"), "0xhunter");
    expect(await run()).toEqual([]);
    expect(await run("0xother")).toEqual([]);
    expect((await run("0xHunter")).map((x) => x.dropId)).toEqual(["1"]);
  });

  it("returns ids as strings even when storage hands them back as numbers", async () => {
    await add("11247", "Pay", {});
    r.m.set(keys.taskDropsBySpot("spot1"), { v: [11247], exp: null });   // how Upstash returns "11247"
    const out = await run();
    expect(out.map((x) => x.dropId)).toEqual(["11247"]);
    expect(typeof out[0].dropId).toBe("string");
  });

  it("lists a reward once even if its id was pushed twice", async () => {
    await add("1", "Buy any coffee", {});
    await r.lpush(keys.taskDropsBySpot("spot1"), "1");
    expect((await run()).length).toBe(1);
  });
});
