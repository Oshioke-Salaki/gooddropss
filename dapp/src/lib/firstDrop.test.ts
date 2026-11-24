import { describe, it, expect, beforeEach } from "vitest";
import type { Redis } from "@upstash/redis";
import { FakeRedis } from "@/lib/testing/fakeRedis";
import { keys } from "@/lib/redis";
import {
  decideFirstDrop, firstDropState, runFirstDropPayout,
  FIRST_DROP_BONUS_WEI, FIRST_DROP_SINCE,
  type BonusSender, type DropLite, type FirstDropDeps, type FirstDropRecord,
} from "./firstDrop";

const A = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000a2"; // A's second wallet
const B = "0x00000000000000000000000000000000000000b1";
const ROOT_A = "0x00000000000000000000000000000000000000aa";
const AFTER = FIRST_DROP_SINCE + 3600;
const LOCK = "lock";

let fake: FakeRedis;
let redis: Redis;
const world = { verified: new Set<string>(), roots: new Map<string, string>(), drops: [] as DropLite[], chain: new Map<string, string>() };

const deps = (over: Partial<FirstDropDeps> = {}): FirstDropDeps => ({
  isVerified: async (a) => world.verified.has(a),
  resolveRoot: async (a) => world.roots.get(a) ?? a,
  dropsOf: async (w, root) => world.drops.filter((d) => d.dropper === w || (world.roots.get(d.dropper) ?? d.dropper) === root),
  readDrop: async (id) => (world.chain.has(id) ? { dropper: world.chain.get(id)! } : null),
  now: () => AFTER + 100,
  ...over,
});

function sender(balanceG: number, fail = new Set<string>()): BonusSender & { sent: string[] } {
  let bal = BigInt(balanceG) * 10n ** 18n;
  const sent: string[] = [];
  return {
    sent,
    balance: async () => bal,
    transfer: async (to, wei) => {
      if (fail.has(to)) throw new Error("rpc down");
      bal -= wei; sent.push(to); return `0xtx${sent.length}`;
    },
  };
}

beforeEach(() => {
  fake = new FakeRedis(); fake.clock = Date.now(); redis = fake as unknown as Redis;
  world.verified = new Set([A, A2, B]);
  world.roots = new Map([[A, ROOT_A], [A2, ROOT_A]]);
  world.drops = []; world.chain = new Map();
});

describe("decideFirstDrop", () => {
  it("offers to a verified person who never dropped", () => {
    expect(decideFirstDrop({ verified: true, drops: [] })).toEqual({ kind: "offer" });
  });
  it("never offers to the unverified", () => {
    expect(decideFirstDrop({ verified: false, drops: [] }).kind).toBe("unverified");
  });
  it("earns on the earliest drop, made after the bonus started", () => {
    const d = decideFirstDrop({ verified: true, drops: [{ id: "9", dropper: A, createdAt: AFTER + 50 }, { id: "7", dropper: A, createdAt: AFTER }] });
    expect(d).toMatchObject({ kind: "earn", drop: { id: "7" } });
  });
  it("is done for anyone who dropped before it started", () => {
    expect(decideFirstDrop({ verified: true, drops: [{ id: "1", dropper: A, createdAt: FIRST_DROP_SINCE - 1 }, { id: "9", dropper: A, createdAt: AFTER }] }).kind).toBe("done");
  });
});

describe("firstDropState", () => {
  it("offers, then registers the bonus to the dropping wallet once they drop", async () => {
    expect((await firstDropState(redis, A, deps())).status).toBe("offer");
    world.drops.push({ id: "100", dropper: A, createdAt: AFTER });
    const v = await firstDropState(redis, A, deps());
    expect(v).toMatchObject({ status: "owed", bonusG: 200, wallet: A });
    const rec = await fake.get<FirstDropRecord>(keys.firstDrop(ROOT_A));
    expect(rec).toMatchObject({ root: ROOT_A, wallet: A, dropId: "100", status: "owed" });
    expect(fake.zmembers(keys.firstDropOwed()).map(([m]) => m)).toEqual([ROOT_A]);
  });

  it("counts a just-made drop the indexer hasn't seen, but only if the chain says it's theirs", async () => {
    world.chain.set("555", B); // someone else's drop
    expect((await firstDropState(redis, A, deps(), "555")).status).toBe("offer");
    world.chain.set("556", A);
    expect((await firstDropState(redis, A, deps(), "556")).status).toBe("owed");
  });

  it("pays one bonus per person, not per wallet", async () => {
    world.drops.push({ id: "100", dropper: A, createdAt: AFTER });
    await firstDropState(redis, A, deps());
    world.drops.push({ id: "101", dropper: A2, createdAt: AFTER + 5 });
    const v = await firstDropState(redis, A2, deps());
    expect(v).toMatchObject({ status: "owed", wallet: A });
    expect(fake.zmembers(keys.firstDropOwed())).toHaveLength(1);
  });

  it("knows a second wallet already dropped, even before any record exists", async () => {
    world.drops.push({ id: "50", dropper: A2, createdAt: FIRST_DROP_SINCE - 10 });
    expect((await firstDropState(redis, A, deps())).status).toBe("done");
  });

  it("says nothing for the unverified and junk input, and writes nothing", async () => {
    world.verified.delete(B);
    expect((await firstDropState(redis, B, deps())).status).toBe("unverified");
    expect((await firstDropState(redis, "nope", deps())).status).toBe("unverified");
    expect(fake.writes()).toEqual([]);
  });

  it("two racing calls register once", async () => {
    world.drops.push({ id: "100", dropper: A, createdAt: AFTER });
    const [x, y] = await Promise.all([firstDropState(redis, A, deps()), firstDropState(redis, A2, deps())]);
    expect([x.status, y.status]).toEqual(["owed", "owed"]);
    expect(fake.zmembers(keys.firstDropOwed())).toHaveLength(1);
  });

  it("lets a chain outage surface as an error, never as a wrong bonus", async () => {
    world.drops.push({ id: "100", dropper: A, createdAt: AFTER });
    await expect(firstDropState(redis, A, deps({ resolveRoot: async () => { throw new Error("rpc"); } }))).rejects.toThrow();
    expect(fake.has(keys.firstDrop(ROOT_A))).toBe(false);
  });
});

describe("runFirstDropPayout", () => {
  async function owe(wallet: string, id: string, at = AFTER) {
    world.drops.push({ id, dropper: wallet, createdAt: at });
    await firstDropState(redis, wallet, deps({ now: () => at }));
  }

  it("pays each queued bonus once, to the dropping wallet, and counts it", async () => {
    await owe(A, "100"); await owe(B, "200", AFTER + 1);
    const s = sender(1000);
    const r = await runFirstDropPayout(redis, s, LOCK);
    expect(r.paid.map((p) => p.to)).toEqual([A, B]);
    expect(s.sent).toEqual([A, B]);
    expect(await fake.get(keys.firstDropPaidG())).toBe(400);
    expect(await fake.get<FirstDropRecord>(keys.firstDrop(ROOT_A))).toMatchObject({ status: "paid", tx: "0xtx1" });
    expect(fake.zmembers(keys.firstDropOwed())).toEqual([]);
    // Re-running sends nothing.
    await runFirstDropPayout(redis, s, LOCK);
    expect(s.sent).toHaveLength(2);
    expect(fake.has(LOCK)).toBe(false);
  });

  it("leaves bonuses waiting when the wallet is short, oldest paid first", async () => {
    await owe(A, "100"); await owe(B, "200", AFTER + 1);
    const r = await runFirstDropPayout(redis, sender(300), LOCK);
    expect(r).toMatchObject({ ok: true, reason: "wallet-short", waiting: 1 });
    expect(r.paid.map((p) => p.to)).toEqual([A]);
    expect(fake.zmembers(keys.firstDropOwed()).map(([m]) => m)).toEqual([B]);
  });

  it("rolls back cleanly when a send fails, and pays it next time", async () => {
    await owe(A, "100");
    const r = await runFirstDropPayout(redis, sender(1000, new Set([A])), LOCK);
    expect(r.errors).toHaveLength(1);
    expect(await fake.get<FirstDropRecord>(keys.firstDrop(ROOT_A))).toMatchObject({ status: "owed" });
    expect(await fake.get(keys.firstDropPaidG())).toBe(0);
    expect((await runFirstDropPayout(redis, sender(1000), LOCK)).paid).toHaveLength(1);
  });

  it("never sends while another payout holds the wallet", async () => {
    await owe(A, "100");
    await fake.set(LOCK, "1", { ex: 300 });
    const s = sender(1000);
    expect(await runFirstDropPayout(redis, s, LOCK)).toMatchObject({ ok: false, reason: "another-run-in-progress" });
    expect(s.sent).toEqual([]);
  });

  it("never re-sends a bonus left mid-send by a killed process", async () => {
    await owe(A, "100");
    const rec = await fake.get<FirstDropRecord>(keys.firstDrop(ROOT_A));
    await fake.set(keys.firstDrop(ROOT_A), JSON.stringify({ ...rec, status: "sending" }));
    const s = sender(1000);
    await runFirstDropPayout(redis, s, LOCK);
    expect(s.sent).toEqual([]);
  });

  it("sends exactly 200 G$", async () => {
    await owe(A, "100");
    let amount = 0n;
    await runFirstDropPayout(redis, { balance: async () => 10n ** 30n, transfer: async (_t, w) => { amount = w; return "0x1"; } }, LOCK);
    expect(amount).toBe(FIRST_DROP_BONUS_WEI);
  });
});
