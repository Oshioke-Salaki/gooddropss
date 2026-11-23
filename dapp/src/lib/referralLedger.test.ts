import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { FakeRedis } from "@/lib/testing/fakeRedis";
import {
  decideInvite, offerInvite, settleInvite, creditReferral, referrerStats, readPending,
  referralAccountFor, PENDING_TTL_S, NEW_MEMBER_WINDOW_S,
  type InviteFacts, type LedgerDeps,
} from "@/lib/referralLedger";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const DAY = 86_400;

// Cast: the fake implements the slice of the client the ledger calls.
const asRedis = (r: FakeRedis) => r as unknown as Redis;

// ── World: who is verified, who has played, what their roots are ─────────────
interface World {
  now: number;
  roots: Map<string, string>;
  verified: Set<string>;
  firstAt: Map<string, number>;
  rootDown: boolean;
  indexDown: boolean;
  credited: { account: string; inviteeRoot: string }[];
}
let world: World;
let redis: FakeRedis;

function deps(): LedgerDeps {
  return {
    now: () => world.now,
    async resolveRoot(a) {
      if (world.rootDown) throw new Error("rpc down");
      return world.roots.get(a.toLowerCase()) ?? a.toLowerCase();
    },
    async isVerified(a) { return world.verified.has(a.toLowerCase()); },
    async hasActivity(a) {
      if (world.indexDown) throw new Error("index down");
      return world.firstAt.has(a.toLowerCase());
    },
    async firstActivityAt(list) {
      if (world.indexDown) throw new Error("index down");
      const t = list.map((a) => world.firstAt.get(a.toLowerCase())).filter((x): x is number => x !== undefined);
      return t.length ? Math.min(...t) : null;
    },
    async onCredited(c) { world.credited.push({ account: c.account, inviteeRoot: c.inviteeRoot }); },
  };
}

const REF = A(1), REF_ROOT = A(100);  // referrer wallet + identity root
const NEW = A(2);                     // a brand-new invitee
const OTHER_REF = A(3);

beforeEach(() => {
  redis = new FakeRedis();
  world = {
    now: 1_800_000_000,
    roots: new Map([[REF, REF_ROOT]]),
    verified: new Set(),
    firstAt: new Map(),
    rootDown: false, indexDown: false,
    credited: [],
  };
  redis.clock = world.now * 1000;
});

/** The invitee verifies and claims their first drop at `at`. */
function qualify(wallet: string, at = world.now) {
  world.verified.add(wallet);
  world.firstAt.set(wallet, at);
}

// ── decideInvite (pure) ─────────────────────────────────────────────────────

describe("decideInvite", () => {
  const base = (): InviteFacts => ({
    now: 1000 * DAY, pending: { referrer: REF, at: 1000 * DAY - DAY },
    inviteeWallet: NEW, inviteeRoot: NEW, referrerRoot: REF_ROOT, account: REF_ROOT,
    inviteeAccount: null, existingReferrer: null,
    verified: true, active: true, firstActivityAt: null,
  });

  it("credits a verified, active, new person", () => {
    expect(decideInvite(base())).toMatchObject({ status: "credited", credit: true });
  });
  it("waits for verification, then activity, then a successful check", () => {
    expect(decideInvite({ ...base(), verified: false })).toMatchObject({ status: "waiting", reason: "verify" });
    expect(decideInvite({ ...base(), active: false })).toMatchObject({ status: "waiting", reason: "task" });
    expect(decideInvite({ ...base(), active: undefined })).toMatchObject({ status: "waiting", reason: "retry" });
    expect(decideInvite({ ...base(), firstActivityAt: undefined })).toMatchObject({ status: "waiting", reason: "retry" });
  });
  it("rejects every flavour of referring yourself", () => {
    for (const patch of [
      { inviteeWallet: REF }, { inviteeRoot: REF_ROOT }, { inviteeRoot: REF },
      { inviteeAccount: REF_ROOT }, { account: NEW },
    ] as Partial<InviteFacts>[]) {
      expect(decideInvite({ ...base(), ...patch })).toMatchObject({ status: "rejected", reason: "self" });
    }
  });
  it("first referrer wins: same account is 'already', another is 'taken'", () => {
    expect(decideInvite({ ...base(), existingReferrer: REF_ROOT }).status).toBe("already");
    expect(decideInvite({ ...base(), existingReferrer: OTHER_REF })).toMatchObject({ status: "rejected", reason: "taken", referrer: OTHER_REF });
  });
  it("measures 'new' from when they ACCEPTED the invite, with the window inclusive", () => {
    const at = base().pending.at;
    expect(decideInvite({ ...base(), firstActivityAt: at - NEW_MEMBER_WINDOW_S }).status).toBe("credited");
    expect(decideInvite({ ...base(), firstActivityAt: at - NEW_MEMBER_WINDOW_S - 1 })).toMatchObject({ status: "rejected", reason: "notNew" });
    // Claimed weeks AFTER accepting: still new (the old flow lost these).
    expect(decideInvite({ ...base(), now: at + 20 * DAY, firstActivityAt: at + 19 * DAY }).status).toBe("credited");
  });
  it("expires an invite that never qualified", () => {
    const at = base().pending.at;
    expect(decideInvite({ ...base(), now: at + PENDING_TTL_S + 1 })).toMatchObject({ status: "rejected", reason: "expired" });
    expect(decideInvite({ ...base(), now: at + PENDING_TTL_S }).status).toBe("credited");
  });
  it("checks final answers before waiting ones (an expired self-invite is expired)", () => {
    expect(decideInvite({ ...base(), verified: false, existingReferrer: OTHER_REF }).reason).toBe("taken");
  });
});

// ── offer + settle against Redis ─────────────────────────────────────────────

describe("offerInvite", () => {
  it("first touch wins", async () => {
    await offerInvite(asRedis(redis), NEW, REF, deps());
    world.now += 60;
    const second = await offerInvite(asRedis(redis), NEW, OTHER_REF, deps());
    expect(second.referrer).toBe(REF);
    expect((await readPending(asRedis(redis), NEW))?.referrer).toBe(REF);
  });
  it("lists the invite as 'on the way' for the referrer's account", async () => {
    await offerInvite(asRedis(redis), NEW, REF, deps());
    expect(await referrerStats(asRedis(redis), REF, deps())).toMatchObject({ account: REF_ROOT, count: 0, waiting: 1 });
  });
  it("normalises address case", async () => {
    await offerInvite(asRedis(redis), NEW.toUpperCase().replace("0X", "0x"), REF.toUpperCase().replace("0X", "0x"), deps());
    expect(await readPending(asRedis(redis), NEW)).toMatchObject({ referrer: REF });
  });
});

describe("settleInvite", () => {
  it("waits, then credits once they verify and play, writing a complete record", async () => {
    await offerInvite(asRedis(redis), NEW, REF, deps());
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "waiting", reason: "verify" });

    world.verified.add(NEW);
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "waiting", reason: "task" });

    world.now += 2 * DAY; world.firstAt.set(NEW, world.now);
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "credited", referrer: REF_ROOT });

    expect(await redis.get(keys.referredBy(NEW))).toBe(REF_ROOT);
    expect(redis.members(keys.referralsOf(REF_ROOT))).toEqual([NEW]);
    expect(redis.zmembers(keys.referralCredited(REF_ROOT))).toEqual([[NEW, world.now]]);
    expect(await redis.zscore(keys.referralLeaders(), REF_ROOT)).toBe(1);
    expect(await redis.get(keys.compPayoutWallet(REF_ROOT))).toBe(REF);
    expect(await redis.get(keys.refAccount(REF))).toBe(REF_ROOT);
    expect(await redis.get(keys.refAccount(REF_ROOT))).toBe(REF_ROOT);
    expect(world.credited).toEqual([{ account: REF_ROOT, inviteeRoot: NEW }]);
    // The invite is gone from every list.
    expect(redis.has(keys.refPending(NEW))).toBe(false);
    expect(redis.zmembers(keys.refPendingAll())).toEqual([]);
    expect(await referrerStats(asRedis(redis), REF, deps())).toMatchObject({ count: 1, waiting: 0 });
  });

  it("is idempotent: settling again changes nothing and doesn't pay twice", async () => {
    qualify(NEW);
    await offerInvite(asRedis(redis), NEW, REF, deps());
    await settleInvite(asRedis(redis), NEW, deps());
    const r = await settleInvite(asRedis(redis), NEW, deps());
    expect(r).toMatchObject({ status: "already", referrer: REF_ROOT });
    expect(await redis.zscore(keys.referralLeaders(), REF_ROOT)).toBe(1);
    expect(world.credited).toHaveLength(1);
  });

  it("counts someone who signed up, left, and claimed their first drop days later", async () => {
    await offerInvite(asRedis(redis), NEW, REF, deps());
    world.now += 10 * DAY;
    qualify(NEW, world.now);
    expect((await settleInvite(asRedis(redis), NEW, deps())).status).toBe("credited");
  });

  it("rejects someone who was already playing before they accepted, and forgets the invite", async () => {
    qualify(NEW, world.now - 10 * DAY);
    await offerInvite(asRedis(redis), NEW, REF, deps());
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "rejected", reason: "notNew" });
    expect(redis.has(keys.refPending(NEW))).toBe(false);
    expect(redis.members(keys.referralsOf(REF_ROOT))).toEqual([]);
    expect((await referrerStats(asRedis(redis), REF, deps())).waiting).toBe(0);
  });

  it("first referrer wins across different wallets of the same person", async () => {
    const W1 = A(20), W2 = A(21), ID = A(22);
    world.roots.set(W1, ID); world.roots.set(W2, ID);
    qualify(W1); qualify(W2);
    await offerInvite(asRedis(redis), W1, REF, deps());
    await offerInvite(asRedis(redis), W2, OTHER_REF, deps());
    const [a, b] = await Promise.all([settleInvite(asRedis(redis), W1, deps()), settleInvite(asRedis(redis), W2, deps())]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["credited", "rejected"]);
    expect(world.credited).toHaveLength(1);
    expect((await redis.get<string>(keys.referredBy(ID)))).toBe(world.credited[0].account);
  });

  it("serialises concurrent settles for the same invitee (one credit, one payout)", async () => {
    qualify(NEW);
    await offerInvite(asRedis(redis), NEW, REF, deps());
    const results = await Promise.all(Array.from({ length: 5 }, () => settleInvite(asRedis(redis), NEW, deps())));
    expect(results.filter((r) => r.status === "credited")).toHaveLength(1);
    expect(world.credited).toHaveLength(1);
    expect(await redis.zscore(keys.referralLeaders(), REF_ROOT)).toBe(1);
  });

  it("never writes a referral when it can't read identities or drops (tries again later)", async () => {
    qualify(NEW);
    await offerInvite(asRedis(redis), NEW, REF, deps());
    world.rootDown = true;
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "waiting", reason: "retry" });
    world.rootDown = false; world.indexDown = true;
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "waiting", reason: "retry" });
    expect(redis.has(keys.referredBy(NEW))).toBe(false);
    expect(redis.has(keys.refPending(NEW))).toBe(true);
    world.indexDown = false;
    expect((await settleInvite(asRedis(redis), NEW, deps())).status).toBe("credited");
  });

  it("rejects an invite to yourself from another of your wallets", async () => {
    const MY_OTHER = A(30);
    world.roots.set(MY_OTHER, REF_ROOT);
    qualify(MY_OTHER);
    await offerInvite(asRedis(redis), MY_OTHER, REF, deps());
    expect(await settleInvite(asRedis(redis), MY_OTHER, deps())).toMatchObject({ status: "rejected", reason: "self" });
  });

  it("rejects when someone else already brought them in, without touching that referral", async () => {
    qualify(NEW);
    await offerInvite(asRedis(redis), NEW, OTHER_REF, deps());
    await settleInvite(asRedis(redis), NEW, deps());
    await offerInvite(asRedis(redis), NEW, REF, deps());
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "rejected", reason: "taken", referrer: OTHER_REF });
    expect(redis.members(keys.referralsOf(OTHER_REF))).toEqual([NEW]);
    expect(redis.members(keys.referralsOf(REF_ROOT))).toEqual([]);
  });

  it("expires an invite that sat for over 30 days and cleans it up", async () => {
    await offerInvite(asRedis(redis), NEW, REF, deps());
    world.now += PENDING_TTL_S + 60; redis.clock = world.now * 1000;
    qualify(NEW);
    expect(await settleInvite(asRedis(redis), NEW, deps())).toMatchObject({ status: "rejected", reason: "expired" });
    expect(redis.zmembers(keys.refPendingAll())).toEqual([]);
    expect(redis.zmembers(keys.refPendingOf(REF_ROOT))).toEqual([]);
  });

  it("answers 'none' for a wallet with no invite, and rejects junk input without I/O", async () => {
    expect((await settleInvite(asRedis(redis), NEW, deps())).status).toBe("none");
    redis.log = [];
    expect((await settleInvite(asRedis(redis), "not-an-address", deps())).status).toBe("none");
    expect(redis.log).toEqual([]);
  });

  it("reads a pending record stored as a JSON string or an object (Upstash parses JSON)", async () => {
    await redis.set(keys.refPending(NEW), JSON.stringify({ referrer: REF, at: 5 }));
    expect(await readPending(asRedis(redis), NEW)).toEqual({ referrer: REF, at: 5 });
    await redis.set(keys.refPending(NEW), "{broken");
    expect(await readPending(asRedis(redis), NEW)).toBeNull();
    await redis.set(keys.refPending(NEW), JSON.stringify({ referrer: "nope", at: 5 }));
    expect(await readPending(asRedis(redis), NEW)).toBeNull();
  });
});

// ── The referrer's account stays put ─────────────────────────────────────────

describe("referral account", () => {
  it("keeps one person's referrals together when their GoodDollar root changes", async () => {
    const N1 = A(40), N2 = A(41);
    qualify(N1); qualify(N2);
    await offerInvite(asRedis(redis), N1, REF, deps());
    await settleInvite(asRedis(redis), N1, deps());

    // Their verification lapses: the wallet now resolves to itself.
    world.roots.delete(REF);
    expect(await referralAccountFor(asRedis(redis), REF, deps())).toBe(REF_ROOT);

    await offerInvite(asRedis(redis), N2, REF, deps());
    await settleInvite(asRedis(redis), N2, deps());
    expect(redis.members(keys.referralsOf(REF_ROOT))).toEqual([N1, N2].sort());
    expect(redis.members(keys.referralsOf(REF))).toEqual([]);
    expect((await referrerStats(asRedis(redis), REF, deps())).count).toBe(2);
  });

  it("follows the identity: a newly linked wallet of the same person shares the account", async () => {
    qualify(NEW);
    await offerInvite(asRedis(redis), NEW, REF, deps());
    await settleInvite(asRedis(redis), NEW, deps());
    const SECOND_WALLET = A(50);
    world.roots.set(SECOND_WALLET, REF_ROOT);
    expect(await referralAccountFor(asRedis(redis), SECOND_WALLET, deps())).toBe(REF_ROOT);
    expect((await referrerStats(asRedis(redis), SECOND_WALLET, deps())).count).toBe(1);
  });

  it("is backward compatible: an unbound referrer is keyed by today's root", async () => {
    expect(await referralAccountFor(asRedis(redis), REF, deps())).toBe(REF_ROOT);
    expect(await referralAccountFor(asRedis(redis), OTHER_REF, deps())).toBe(OTHER_REF);
  });
});

describe("creditReferral", () => {
  const c = (account: string) => ({ inviteeRoot: NEW, account, referrerWallet: REF, referrerRoot: REF_ROOT, at: world.now });

  it("lets exactly one of two racing referrers win", async () => {
    const onCredited = vi.fn(async () => {});
    const [a, b] = await Promise.all([creditReferral(asRedis(redis), c(REF_ROOT), { onCredited }), creditReferral(asRedis(redis), c(OTHER_REF), { onCredited })]);
    expect([a.status, b.status].sort()).toEqual(["credited", "rejected"]);
    expect(onCredited).toHaveBeenCalledTimes(1);
  });

  it("repairs a half-written record for the same referrer without double counting", async () => {
    await redis.set(keys.referredBy(NEW), REF_ROOT); // written, then the process died
    const r = await creditReferral(asRedis(redis), c(REF_ROOT), {});
    expect(r.status).toBe("credited");
    expect(redis.members(keys.referralsOf(REF_ROOT))).toEqual([NEW]);
    expect((await creditReferral(asRedis(redis), c(REF_ROOT), {})).status).toBe("already");
    expect(await redis.zscore(keys.referralLeaders(), REF_ROOT)).toBe(1);
  });

  it("keeps an existing prize wallet when asked to (admin entries)", async () => {
    await redis.set(keys.compPayoutWallet(REF_ROOT), A(77));
    await creditReferral(asRedis(redis), { ...c(REF_ROOT), payoutWallet: "keep" }, {});
    expect(await redis.get(keys.compPayoutWallet(REF_ROOT))).toBe(A(77));
  });

  it("keeps the first credit time if re-run (competition order can't be gamed)", async () => {
    await creditReferral(asRedis(redis), c(REF_ROOT), {});
    world.now += 1000;
    await creditReferral(asRedis(redis), c(REF_ROOT), {});
    expect(redis.zmembers(keys.referralCredited(REF_ROOT))[0][1]).toBe(world.now - 1000);
  });
});
