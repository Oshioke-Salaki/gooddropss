import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { approveTaskToken, parseApproveToken } from "./taskApprove";
import { issueTaskCode } from "./taskCode";
import { APPROVAL_TTL_S, MERCHANT_DAILY_CAP } from "./taskShared";
import { keys } from "./redis";
import { fakeRedis, asRedis, type FakeRedis } from "@/test/fakeRedis";

const OWNER = "0x" + "a".repeat(40);
const T0 = 1_800_000_000;

describe("parseApproveToken", () => {
  it("accepts six digits (spaced or not) and 32-hex nonces, nothing else", () => {
    expect(parseApproveToken("481 205")).toBe("481205");
    expect(parseApproveToken("F".repeat(32))).toBe("f".repeat(32));
    expect(parseApproveToken("12345")).toBeNull();
    expect(parseApproveToken("abc")).toBeNull();
    expect(parseApproveToken(undefined)).toBeNull();
  });
});

describe("approveTaskToken", () => {
  let r: FakeRedis;
  let chain: { status: number; expiry: number } | "down";
  const readDrop = async () => { if (chain === "down") throw new Error("rpc"); return chain; };
  const approve = (token: string, merchant = OWNER) =>
    approveTaskToken(asRedis(r), { token, merchant, readDrop, now: T0 });
  const issue = async (root = "0xhunter", dropId = "42") => {
    const c = await issueTaskCode(asRedis(r), { dropId, root, spotId: "spot1" });
    if (!c.ok) throw new Error("expected a code");
    return c;
  };

  beforeEach(async () => {
    r = fakeRedis();
    vi.useFakeTimers(); vi.setSystemTime(T0 * 1000);
    chain = { status: 0, expiry: T0 + 3600 };
    await r.set(keys.spot("spot1"), { id: "spot1", ownerAddress: OWNER.toUpperCase().replace("0X", "0x"), status: "active" });
  });
  afterEach(() => vi.useRealTimers());

  it("approves by nonce or typed code, and unlocks the claim for that person", async () => {
    const c = await issue();
    expect(await approve(c.code!)).toEqual({ ok: true, dropId: "42" });
    expect(await r.get(keys.taskApproval("42", "0xhunter"))).toEqual({ spotId: "spot1", at: T0 });
    expect(await r.ttl(keys.taskApproval("42", "0xhunter"))).toBe(APPROVAL_TTL_S);
  });

  it("burns the code: the same code can't be approved twice", async () => {
    const c = await issue();
    expect((await approve(c.nonce)).ok).toBe(true);
    expect(await approve(c.nonce)).toMatchObject({ ok: false, status: 404 });
    expect(await approve(c.code!)).toMatchObject({ ok: false, status: 404 });
    expect(await r.get(keys.taskQrMine("42", "0xhunter"))).toBeNull();
  });

  it("only the shop's owner can approve", async () => {
    const c = await issue();
    expect(await approve(c.nonce, "0x" + "b".repeat(40))).toMatchObject({ ok: false, status: 403 });
    expect(await r.get(keys.taskApproval("42", "0xhunter"))).toBeNull();
  });

  it("a shop that isn't live can't approve", async () => {
    await r.set(keys.spot("spot1"), { id: "spot1", ownerAddress: OWNER, status: "paused" });
    const c = await issue();
    expect(await approve(c.nonce)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a reward that's claimed, expired, or can't be read, and keeps the code usable", async () => {
    const c = await issue();
    chain = { status: 1, expiry: T0 + 3600 };
    expect(await approve(c.nonce)).toMatchObject({ ok: false, status: 409 });
    chain = { status: 0, expiry: T0 };
    expect(await approve(c.nonce)).toMatchObject({ ok: false, status: 409 });
    chain = "down";
    expect(await approve(c.nonce)).toMatchObject({ ok: false, status: 503 });
    chain = { status: 0, expiry: T0 + 3600 };
    expect((await approve(c.nonce)).ok).toBe(true);
  });

  it("holds the reward for one customer; a second customer's code is refused and nothing leaks", async () => {
    const a = await issue("0xhunter");
    vi.setSystemTime((T0 + 1) * 1000);
    const b = await issue("0xother");
    expect((await approve(a.nonce)).ok).toBe(true);
    const res = await approve(b.nonce);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(await r.get(keys.taskQr(b.nonce))).not.toBeNull();     // not burned
    expect(await r.get(keys.taskApproval("42", "0xother"))).toBeNull();
    const day = new Date(T0 * 1000).toISOString().slice(0, 10);
    expect(await r.get(keys.taskApprovalsDaily("spot1", day))).toBe(1); // only the real approval counted
  });

  it("enforces the daily cap and rolls back the hold when it bites", async () => {
    const day = new Date(T0 * 1000).toISOString().slice(0, 10);
    await r.set(keys.taskApprovalsDaily("spot1", day), MERCHANT_DAILY_CAP);
    const c = await issue();
    expect(await approve(c.nonce)).toMatchObject({ ok: false, status: 429 });
    expect(await r.get(keys.taskReserved("42"))).toBeNull();
    expect(await r.get(keys.taskApprovalsDaily("spot1", day))).toBe(MERCHANT_DAILY_CAP);
    expect(await r.get(keys.taskQr(c.nonce))).not.toBeNull();
  });
});
