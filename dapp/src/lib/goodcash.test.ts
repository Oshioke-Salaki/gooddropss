import { describe, expect, it, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
import { encodeFunctionData, parseAbi, parseUnits, type Hex } from "viem";
import { checkCashOutTx, encodeOrderData, GOODCASH_ROUTER, TRANSFER_AND_CALL_ABI, type CashOutOrder } from "@/lib/goodcash";
import { classify } from "@/lib/sponsorPolicy";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";

vi.mock("@/lib/redis", () => ({ getRedis: () => null, keys: {} }));

const PAY_TO = "0x1111111111111111111111111111111111111111" as Hex;
const ATTACKER = "0x2222222222222222222222222222222222222222" as Hex;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const amountWei = parseUnits("5000", 18);

function build(over: { router?: Hex; amount?: bigint; payTo?: Hex; payAmount?: bigint; minOut?: bigint; deadline?: bigint; tail?: string } = {}) {
  const minOut = over.minOut ?? 3_000_000n;
  const payAmount = over.payAmount ?? 2_900_000n;
  const deadline = over.deadline ?? BigInt(Math.floor(NOW / 1000) + 600);
  const inner = encodeOrderData({ route: 0, minOut, deadline, payTo: over.payTo ?? PAY_TO, payAmount, ref: `0x${"ab".repeat(32)}` });
  const data = encodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [over.router ?? GOODCASH_ROUTER, over.amount ?? amountWei, inner] });
  const tx = { chainId: 42220, to: G_TOKEN_ADDRESS, data: data + (over.tail ?? ""), value: "0x0" };
  const order: CashOutOrder = {
    router: GOODCASH_ROUTER, payTo: PAY_TO, payAmount: "2900000", amountWei: amountWei.toString(), minOut: "3000000",
    validUntil: new Date(NOW + 700_000).toISOString(),
  };
  return { tx, order };
}

describe("checkCashOutTx: what a wallet may be asked to sign", () => {
  it("accepts the exact cash out and returns the call to send", () => {
    const { tx, order } = build();
    const r = checkCashOutTx(tx, order, amountWei, { nowMs: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.call.amountWei).toBe(amountWei);
  });
  it("refuses a different router", () => {
    const { tx, order } = build({ router: ATTACKER });
    expect(checkCashOutTx(tx, order, amountWei, { nowMs: NOW })).toEqual({ ok: false, reason: "wrong_router" });
  });
  it("refuses a router swapped in the order details too", () => {
    const { tx, order } = build();
    expect(checkCashOutTx(tx, { ...order, router: ATTACKER }, amountWei, { nowMs: NOW }).ok).toBe(false);
  });
  it("refuses more G$ than the person typed", () => {
    const { tx, order } = build({ amount: amountWei * 2n });
    expect(checkCashOutTx(tx, { ...order, amountWei: (amountWei * 2n).toString() }, amountWei, { nowMs: NOW })).toEqual({ ok: false, reason: "wrong_amount" });
  });
  it("refuses a payout address that differs from the order", () => {
    const { tx, order } = build({ payTo: ATTACKER });
    expect(checkCashOutTx(tx, order, amountWei, { nowMs: NOW })).toEqual({ ok: false, reason: "wrong_pay_to" });
  });
  it("refuses paying out more than the guaranteed minimum", () => {
    const { tx, order } = build({ payAmount: 3_100_000n });
    expect(checkCashOutTx(tx, { ...order, payAmount: "3100000" }, amountWei, { nowMs: NOW })).toEqual({ ok: false, reason: "bad_minimum" });
  });
  it("refuses an order that has closed, except in test mode", () => {
    const { tx, order } = build({ deadline: 1n });
    expect(checkCashOutTx(tx, order, amountWei, { nowMs: NOW })).toEqual({ ok: false, reason: "expired" });
    expect(checkCashOutTx(tx, order, amountWei, { nowMs: NOW, testMode: true }).ok).toBe(true);
  });
  it("refuses sending CELO, another token, another chain, or extra bytes", () => {
    const { tx, order } = build();
    expect(checkCashOutTx({ ...tx, value: "0x1" }, order, amountWei, { nowMs: NOW }).ok).toBe(false);
    expect(checkCashOutTx({ ...tx, to: ATTACKER }, order, amountWei, { nowMs: NOW }).ok).toBe(false);
    expect(checkCashOutTx({ ...tx, chainId: 1 }, order, amountWei, { nowMs: NOW }).ok).toBe(false);
    const extra = build({ tail: "deadbeef" });
    expect(checkCashOutTx(extra.tx, extra.order, amountWei, { nowMs: NOW }).ok).toBe(false);
  });
  it("refuses an approve or a plain transfer dressed up as a cash out", () => {
    const { order } = build();
    const erc20 = parseAbi(["function approve(address,uint256)", "function transfer(address,uint256)"]);
    for (const data of [
      encodeFunctionData({ abi: erc20, functionName: "approve", args: [ATTACKER, amountWei] }),
      encodeFunctionData({ abi: erc20, functionName: "transfer", args: [ATTACKER, amountWei] }),
    ]) {
      expect(checkCashOutTx({ chainId: 42220, to: G_TOKEN_ADDRESS, data, value: "0x0" }, order, amountWei, { nowMs: NOW }).ok).toBe(false);
    }
  });
});

describe("sponsorship: free network fee only for a real cash out", () => {
  it("sponsors G$ sent to the GoodCash router", () => {
    const { tx } = build();
    expect(classify({ target: G_TOKEN_ADDRESS, value: 0n, data: tx.data as Hex })).toBe("cashout");
  });
  it("does not sponsor transferAndCall to anything else", () => {
    const { tx } = build({ router: ATTACKER });
    expect(classify({ target: G_TOKEN_ADDRESS, value: 0n, data: tx.data as Hex })).toBeNull();
  });
});

describe("server records (test mode keeps them in memory)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GOODCASH_SECRET_KEY = "gc_sk_test_x";
    (globalThis as { __gcMemStore?: unknown }).__gcMemStore = undefined;
  });

  it("verifies webhook signatures on the raw body, within 5 minutes", async () => {
    const { verifySignature } = await import("@/lib/goodcashServer");
    const raw = '{"id":"evt_1"}';
    const t = 1_800_000_000;
    const sig = createHmac("sha256", "whsec_x").update(`${t}.${raw}`).digest("hex");
    expect(verifySignature(raw, `t=${t},v1=${sig}`, "whsec_x", t)).toBe(true);
    expect(verifySignature(raw + " ", `t=${t},v1=${sig}`, "whsec_x", t)).toBe(false);
    expect(verifySignature(raw, `t=${t},v1=${sig}`, "whsec_other", t)).toBe(false);
    expect(verifySignature(raw, `t=${t},v1=${sig}`, "whsec_x", t + 301)).toBe(false);
    expect(verifySignature(raw, null, "whsec_x", t)).toBe(false);
  });

  it("refuses to run on a publishable key", async () => {
    process.env.GOODCASH_SECRET_KEY = "gc_pk_test_x";
    const { gcConfig } = await import("@/lib/goodcashServer");
    expect(gcConfig()).toBeNull();
  });

  it("counts a paid cash out in the total exactly once, and frees the cap when it fails", async () => {
    const m = await import("@/lib/goodcashServer");
    const s = m.store()!;
    const root = "0xroot";
    const day = m.lagosDay();
    const base = {
      wallet: "0xw", root, day, amountG: "5000", amountWei: parseUnits("5000", 18).toString(), naira: 7000, nairaPerDollar: 1500,
      accountName: "ADA OBI", bankName: "Test Bank A", accountLast4: "1234", createdAt: new Date().toISOString(),
    };
    await m.saveOrder(s, { ...base, id: "a" });
    await m.saveOrder(s, { ...base, id: "b" });
    await m.markDay(s, root, day, "a", base.amountWei, Date.now() + 60_000, "awaiting_signature");
    await m.markDay(s, root, day, "b", base.amountWei, Date.now() + 60_000, "awaiting_signature");
    expect(await m.usedTodayWei(s, root)).toBe(parseUnits("10000", 18));

    const paid = { id: "a", mode: "test" as const, status: "paid" as const, wallet: "0xw", amountG: "5000", receive: { naira: 7012.5 }, createdAt: "", paidAt: "2026-11-20T12:00:00Z" };
    await m.syncCashOut(s, paid);
    await m.syncCashOut(s, paid); // webhook and status read both arrive
    await m.syncCashOut(s, { ...paid, id: "b", status: "failed" });

    const t = await m.totals(s);
    expect(t.count).toBe(1);
    expect(t.g).toBe(5000);
    expect(t.naira).toBe(7012.5);
    expect(t.people).toBe(1);
    expect(t.recent[0]).toMatchObject({ id: "a", naira: 7012.5, nairaPerDollar: 1500 });
    expect(await m.usedTodayWei(s, root)).toBe(parseUnits("5000", 18)); // the failed one no longer counts
  });

  it("lets an unsigned order stop counting once it closes", async () => {
    const m = await import("@/lib/goodcashServer");
    const s = m.store()!;
    await m.markDay(s, "0xr2", m.lagosDay(), "c", parseUnits("100", 18).toString(), Date.now() - 1, "awaiting_signature");
    expect(await m.usedTodayWei(s, "0xr2")).toBe(0n);
  });

  it("ignores cash outs that aren't ours", async () => {
    const m = await import("@/lib/goodcashServer");
    const s = m.store()!;
    expect(await m.syncCashOut(s, { id: "zzz", mode: "test", status: "paid", wallet: "0x", amountG: "1", createdAt: "" })).toBeNull();
    expect((await m.totals(s)).count).toBe(0);
  });
});

describe("GoodDrops' 1% fee split", () => {
  it("splits in G$ cents, and the halves always add back up", async () => {
    const { splitAmount } = await import("@/lib/goodcash");
    expect(splitAmount("50000")).toEqual({ cashG: "49500", feeG: "500" });
    expect(splitAmount("3550")).toEqual({ cashG: "3514.5", feeG: "35.5" });
    expect(splitAmount("10.99")).toEqual({ cashG: "10.89", feeG: "0.1" });
    for (const t of ["1", "99.99", "123456.78", "182450"]) {
      const { cashG, feeG } = splitAmount(t);
      expect(Math.round((Number(cashG) + Number(feeG)) * 100)).toBe(Math.round(Number(t) * 100));
    }
  });
  it("sponsors the fee transfer alongside the cash out", async () => {
    const { GOODDROPS_FEE_WALLET } = await import("@/lib/goodcash");
    const erc20 = parseAbi(["function transfer(address,uint256)"]);
    const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [GOODDROPS_FEE_WALLET, 10n] });
    expect(classify({ target: G_TOKEN_ADDRESS, value: 0n, data })).toBe("transfer");
  });
});
