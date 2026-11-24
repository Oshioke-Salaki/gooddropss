import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { FakeRedis } from "@/lib/testing/fakeRedis";
import { keys } from "@/lib/redis";
import { referralAcceptMessage } from "@/lib/referral";
import type { LedgerDeps } from "@/lib/referralLedger";

// End-to-end through the real route handlers: real signatures, the real ledger,
// a fake Redis and a fake chain/indexer.

const fake = { redis: new FakeRedis() };
const world = {
  verified: new Set<string>(),
  firstAt: new Map<string, number>(),
  roots: new Map<string, string>(),
};

vi.mock("@/lib/redis", async (orig) => ({ ...(await orig<typeof import("@/lib/redis")>()), getRedis: () => fake.redis }));
vi.mock("@/lib/identityRoot", () => ({
  resolveIdentityRoot: async (a: string) => world.roots.get(a.toLowerCase()) ?? a.toLowerCase(),
  resolveIdentityRootStrict: async (a: string) => world.roots.get(a.toLowerCase()) ?? a.toLowerCase(),
  isVerifiedHuman: async (a: string) => world.verified.has(a.toLowerCase()),
}));
vi.mock("@/lib/subgraph", () => ({
  fetchFirstActivityAt: async (l: string[]) => {
    const t = l.map((a) => world.firstAt.get(a.toLowerCase())).filter((x): x is number => x !== undefined);
    return t.length ? Math.min(...t) : null;
  },
}));
vi.mock("@/lib/referralDeps", () => ({
  ledgerDeps: (): LedgerDeps => ({
    resolveRoot: async (a) => world.roots.get(a.toLowerCase()) ?? a.toLowerCase(),
    isVerified: async (a) => world.verified.has(a.toLowerCase()),
    hasActivity: async (a) => world.firstAt.has(a.toLowerCase()),
    firstActivityAt: async (l) => {
      const t = l.map((a) => world.firstAt.get(a.toLowerCase())).filter((x): x is number => x !== undefined);
      return t.length ? Math.min(...t) : null;
    },
  }),
}));

const { GET, POST } = await import("@/app/api/referral/route");
const { POST: SETTLE } = await import("@/app/api/referral/settle/route");

const invitee = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const REFERRER = "0x00000000000000000000000000000000000000aa";
const me = invitee.address.toLowerCase();

function req(url: string, init?: { method?: string; body?: unknown; ip?: string }) {
  return new NextRequest(`https://gooddrops.xyz${url}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json", "x-real-ip": init?.ip ?? "1.2.3.4" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
async function offer(signer = invitee, referrer = REFERRER, ts = Date.now(), ip?: string) {
  const signature = await signer.signMessage({ message: referralAcceptMessage(referrer, ts) });
  return POST(req("/api/referral", { method: "POST", body: { referrer, signature, timestamp: ts }, ip }));
}

beforeEach(() => {
  fake.redis = new FakeRedis();
  fake.redis.clock = Date.now();
  world.verified.clear(); world.firstAt.clear(); world.roots.clear();
});

describe("POST /api/referral", () => {
  it("saves the invite for an unverified newcomer and says what's left", async () => {
    const r = await offer();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "waiting", reason: "verify", referrer: REFERRER });
    expect(fake.redis.has(keys.refPending(me))).toBe(true);
  });

  it("counts it straight away when they already qualify", async () => {
    world.verified.add(me); world.firstAt.set(me, Math.floor(Date.now() / 1000));
    const r = await offer();
    expect(await r.json()).toMatchObject({ status: "credited", referrer: REFERRER });
    expect(fake.redis.members(keys.referralsOf(REFERRER))).toEqual([me]);
  });

  it("rejects a forged or mismatched signature", async () => {
    const ts = Date.now();
    // Signed for a different referrer than the one sent.
    const signature = await invitee.signMessage({ message: referralAcceptMessage("0x00000000000000000000000000000000000000bb", ts) });
    const r = await POST(req("/api/referral", { method: "POST", body: { referrer: REFERRER, signature, timestamp: ts } }));
    // Recovers SOME address, just not the invitee: it's saved for that address, never for them.
    expect(r.status).toBe(200);
    expect(fake.redis.has(keys.refPending(me))).toBe(false);

    const bad = await POST(req("/api/referral", { method: "POST", body: { referrer: REFERRER, signature: "0x1234", timestamp: ts } }));
    expect(bad.status).toBe(401);
  });

  it("rejects stale signatures and malformed bodies", async () => {
    expect((await offer(invitee, REFERRER, Date.now() - 25 * 3600_000)).status).toBe(400);
    expect((await POST(req("/api/referral", { method: "POST", body: { referrer: "nope" } }))).status).toBe(400);
    expect((await POST(req("/api/referral", { method: "POST", body: { referrer: REFERRER, signature: "zz", timestamp: 1 } }))).status).toBe(400);
    const raw = new NextRequest("https://gooddrops.xyz/api/referral", { method: "POST", body: "{not json" });
    expect((await POST(raw)).status).toBe(400);
  });

  it("refuses your own link without saving anything", async () => {
    const r = await offer(invitee, me);
    expect(await r.json()).toMatchObject({ status: "rejected", reason: "self" });
    expect(fake.redis.has(keys.refPending(me))).toBe(false);
  });

  it("rate limits per IP", async () => {
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await offer(stranger, REFERRER, Date.now(), "9.9.9.9")).status;
    expect(last).toBe(429);
    expect((await offer(stranger, REFERRER, Date.now(), "8.8.8.8")).status).toBe(200);
  });
});

describe("POST /api/referral/settle", () => {
  it("counts a saved invite once the invitee qualifies (no signature needed)", async () => {
    await offer();
    world.verified.add(me); world.firstAt.set(me, Math.floor(Date.now() / 1000));
    const r = await SETTLE(req("/api/referral/settle", { method: "POST", body: { invitee: me } }));
    expect(await r.json()).toMatchObject({ status: "credited" });
  });
  it("does nothing for a wallet that never accepted an invite", async () => {
    world.verified.add(me); world.firstAt.set(me, Math.floor(Date.now() / 1000));
    const r = await SETTLE(req("/api/referral/settle", { method: "POST", body: { invitee: me } }));
    expect(await r.json()).toMatchObject({ status: "none" });
    expect(fake.redis.members(keys.referralsOf(REFERRER))).toEqual([]);
  });
  it("validates input", async () => {
    expect((await SETTLE(req("/api/referral/settle", { method: "POST", body: { invitee: "x" } }))).status).toBe(400);
  });
});

describe("GET /api/referral", () => {
  it("shows the referrer what's counted and what's on the way, and the invitee their own invite", async () => {
    await offer();
    const asReferrer = await (await GET(req(`/api/referral?address=${REFERRER}`))).json();
    expect(asReferrer).toMatchObject({ count: 0, waiting: 1 });
    const asInvitee = await (await GET(req(`/api/referral?address=${me}`))).json();
    expect(asInvitee).toMatchObject({ invite: { status: "waiting", referrer: REFERRER }, canBeInvited: false });

    world.verified.add(me); world.firstAt.set(me, Math.floor(Date.now() / 1000));
    await SETTLE(req("/api/referral/settle", { method: "POST", body: { invitee: me } }));
    expect(await (await GET(req(`/api/referral?address=${REFERRER}`))).json()).toMatchObject({ count: 1, waiting: 0 });
    expect(await (await GET(req(`/api/referral?address=${me}`))).json()).toMatchObject({ invite: { status: "already", referrer: REFERRER } });
  });

  it("says whether someone is still new enough to be invited", async () => {
    const fresh = await (await GET(req(`/api/referral?address=${me}`))).json();
    expect(fresh).toMatchObject({ invite: { status: "none" }, canBeInvited: true });
    world.firstAt.set(me, Math.floor(Date.now() / 1000) - 10 * 86_400);
    expect(await (await GET(req(`/api/referral?address=${me}`))).json()).toMatchObject({ canBeInvited: false });
  });

  it("validates the address", async () => {
    expect((await GET(req("/api/referral?address=junk"))).status).toBe(400);
  });
});

// ── The sweep cron ───────────────────────────────────────────────────────────
vi.mock("@/lib/refPayout", () => ({ tryRefPayout: vi.fn(async () => {}) }));
vi.mock("@/lib/firstDropServer", () => ({ tryFirstDropPayout: vi.fn(async () => {}) }));
const { GET: SWEEP } = await import("@/app/api/cron/referrals/route");
const { tryRefPayout } = await import("@/lib/refPayout");

describe("GET /api/cron/referrals", () => {
  const cron = (auth = "Bearer s3cret") => new NextRequest("https://gooddrops.xyz/api/cron/referrals", { headers: { authorization: auth } });
  beforeEach(() => { process.env.CRON_SECRET = "s3cret"; vi.mocked(tryRefPayout).mockClear(); });

  it("refuses without the cron secret (and when none is configured)", async () => {
    expect((await SWEEP(cron("Bearer nope"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await SWEEP(cron())).status).toBe(401);
  });

  it("counts everyone who has since qualified, leaves the rest waiting, pays once", async () => {
    await offer();                                   // will qualify
    await offer(stranger);                           // won't
    world.verified.add(me); world.firstAt.set(me, Math.floor(Date.now() / 1000));
    const res = await (await SWEEP(cron())).json();
    expect(res).toMatchObject({ ok: true, checked: 2, tally: { credited: 1, "waiting:verify": 1 } });
    expect(fake.redis.members(keys.referralsOf(REFERRER))).toEqual([me]);
    expect(fake.redis.has(keys.refPending(stranger.address.toLowerCase()))).toBe(true);
    expect(tryRefPayout).toHaveBeenCalledTimes(1);
    expect(fake.redis.has(keys.refSweepLock())).toBe(false);
  });

  it("drops rows whose invite record is gone", async () => {
    await fake.redis.zadd(keys.refPendingAll(), { score: Math.floor(Date.now() / 1000), member: me });
    const res = await (await SWEEP(cron())).json();
    expect(res.tally).toEqual({ none: 1 });
    expect(fake.redis.zmembers(keys.refPendingAll())).toEqual([]);
    expect(tryRefPayout).not.toHaveBeenCalled();
  });

  it("never runs two sweeps at once", async () => {
    await fake.redis.set(keys.refSweepLock(), "1", { ex: 120 });
    expect(await (await SWEEP(cron())).json()).toMatchObject({ ok: false, reason: "another-run-in-progress" });
  });
});
