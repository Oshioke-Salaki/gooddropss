import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { issueTaskCode } from "./taskCode";
import { QR_COOLDOWN_S, QR_REUSE_MIN_S, QR_TTL_S, type TaskQrRecord } from "./taskShared";
import { keys } from "./redis";
import { fakeRedis, asRedis, type FakeRedis } from "@/test/fakeRedis";

const REC = { dropId: "42", root: "0xRoot", spotId: "spot1" };
const T0 = 1_800_000_000_000;

describe("issueTaskCode", () => {
  let r: FakeRedis;
  const issue = (rec = REC) => issueTaskCode(asRedis(r), rec);
  beforeEach(() => { r = fakeRedis(); vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => vi.useRealTimers());

  it("mints a nonce, a six-digit code and the records the shop's scan needs", async () => {
    const a = await issue();
    if (!a.ok) throw new Error("expected a code");
    expect(a.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(a.code).toMatch(/^\d{6}$/);
    expect(a.expiresInS).toBe(QR_TTL_S);
    expect(a.reused).toBe(false);
    const qr = await r.get<TaskQrRecord>(keys.taskQr(a.nonce));
    expect(qr).toEqual({ dropId: "42", root: "0xroot", spotId: "spot1", code: a.code });
    expect(await r.get(keys.taskCode(a.code!))).toBe(a.nonce);
  });

  it("hands out the SAME code while it's fresh, without tripping the cooldown", async () => {
    const a = await issue();
    vi.setSystemTime(T0 + 5_000);                 // inside the cooldown
    const b = await issue();
    if (!a.ok || !b.ok) throw new Error("expected codes");
    expect(b.nonce).toBe(a.nonce);
    expect(b.code).toBe(a.code);
    expect(b.reused).toBe(true);
    expect(b.expiresInS).toBe(QR_TTL_S - 5);
  });

  it("replaces a code that's about to expire, and the old one keeps working until it does", async () => {
    const a = await issue();
    vi.setSystemTime(T0 + (QR_TTL_S - QR_REUSE_MIN_S) * 1000);
    const b = await issue();
    if (!a.ok || !b.ok) throw new Error("expected codes");
    expect(b.nonce).not.toBe(a.nonce);
    expect(b.reused).toBe(false);
    expect(await r.get(keys.taskQr(a.nonce))).not.toBeNull();
  });

  it("asks a person to wait before a NEW code inside the cooldown", async () => {
    await issue();
    const other = await issue({ ...REC, dropId: "43" });
    expect(other).toEqual({ ok: false, retryAfterS: QR_COOLDOWN_S });
    vi.setSystemTime(T0 + QR_COOLDOWN_S * 1000);
    expect((await issue({ ...REC, dropId: "43" })).ok).toBe(true);
  });

  it("mints fresh once the code was used (approved and burned)", async () => {
    const a = await issue();
    if (!a.ok) throw new Error("expected a code");
    await r.del(keys.taskQr(a.nonce));
    vi.setSystemTime(T0 + QR_COOLDOWN_S * 1000);
    const b = await issue();
    if (!b.ok) throw new Error("expected a code");
    expect(b.nonce).not.toBe(a.nonce);
  });

  it("never hands one person's code to another", async () => {
    const a = await issue();
    const b = await issue({ ...REC, root: "0xsomeoneelse" });
    if (!a.ok || !b.ok) throw new Error("expected codes");
    expect(b.nonce).not.toBe(a.nonce);
  });
});
