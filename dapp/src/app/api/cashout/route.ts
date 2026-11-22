import { NextRequest, NextResponse } from "next/server";
import { parseUnits } from "viem";
import {
  banks, cashOutEnabled, gc, gcConfig, lagosDay, markDay, saveOrder, store, toView, underLimit, withPersonLock,
  ACCOUNT_RE, ADDR_RE, AMOUNT_RE, type GcCashOut, type GcLimits,
} from "@/lib/goodcashServer";
import { checkCashOutTx, withdrawCapG, type CashOutOrder, type CashOutTx, type FeeLine, type Quote } from "@/lib/goodcash";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { clientIp } from "@/lib/eventAuth";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

type Created = GcCashOut & { fees?: FeeLine[]; transaction: CashOutTx; order: CashOutOrder };

const fail = (error: string, status: number, code?: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, code, ...extra }, { status, headers: NO_STORE });

// POST /api/cashout → create a cash out and hand back the exact transaction to sign.
// Body: { wallet, amountG, bankCode, accountNumber, feePercentShown, attemptKey }
//
// No signature is needed to create one: an order can only be paid by the wallet
// itself signing the transaction. What we guard here is the daily cap (per
// person, across all their linked wallets) and abuse of the name lookup.
export async function POST(req: NextRequest) {
  if (!cashOutEnabled()) return fail("Withdrawals aren't available yet.", 404);
  const s = store();
  if (!s) return fail("Withdrawals are busy right now. Please try again in a moment.", 503);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail("Invalid request", 400); }
  const wallet = typeof b.wallet === "string" ? b.wallet : "";
  const amountG = typeof b.amountG === "string" ? b.amountG.trim() : "";
  const bankCode = typeof b.bankCode === "string" ? b.bankCode.trim() : "";
  const accountNumber = typeof b.accountNumber === "string" ? b.accountNumber.trim() : "";
  const feePercentShown = typeof b.feePercentShown === "number" ? b.feePercentShown : NaN;
  const attemptKey = typeof b.attemptKey === "string" ? b.attemptKey : "";
  if (!ADDR_RE.test(wallet) || !AMOUNT_RE.test(amountG) || !bankCode || bankCode.length > 20
    || !ACCOUNT_RE.test(accountNumber) || !Number.isFinite(feePercentShown) || !KEY_RE.test(attemptKey)) {
    return fail("Something's missing. Go back and check the details.", 400, "invalid_request");
  }
  const amountWei = parseUnits(amountG, 18);
  if (amountWei <= 0n) return fail("Enter an amount.", 400, "invalid_request");

  if (!(await underLimit(s, "create-ip", clientIp(req.headers), 20, 600))) {
    return fail("Too many tries. Wait a few minutes and try again.", 429, "rate_limited");
  }

  const root = await resolveIdentityRoot(wallet);
  const result = await withPersonLock(s, root, async () => {
    // One withdrawal is at most our cap for this wallet (no daily limit).
    // GoodCash's own maximum is checked below for everyone.
    const cap = withdrawCapG(wallet);
    if (Number.isFinite(cap) && amountWei > parseUnits(String(cap), 18)) {
      return fail(`The most you can withdraw at once is ${cap.toLocaleString("en-US")} G$.`, 400, "amount_too_large");
    }

    // The bank's own name for the account, the bank's display name, and a fresh
    // price (only for our record of the naira rate at the time).
    const [name, bankList, quote, limits] = await Promise.all([
      gc<{ accountName?: string }>("/v1/banks/verify", { method: "POST", body: { bankCode, accountNumber } }),
      banks(),
      gc<Quote>(`/v1/quote?amountG=${encodeURIComponent(amountG)}`),
      gc<GcLimits>("/v1/limits"),
    ]);
    if (!name.ok) {
      return name.error.code === "bank_account_not_found"
        ? fail("We couldn't find that account. Check the bank and the number.", 400, name.error.code)
        : fail(name.error.message, name.error.status, name.error.code);
    }
    const accountName = name.data.accountName ?? "";
    if (!accountName) return fail("We couldn't find that account. Check the bank and the number.", 400, "bank_account_not_found");
    if (limits.ok && Number(amountG) > limits.data.maximumG) {
      return fail(`The most you can withdraw at once is ${limits.data.maximumG.toLocaleString("en-US")} G$.`, 400, "amount_too_large");
    }
    const bankName = (bankList.ok ? bankList.data.find((x) => x.code === bankCode)?.name : undefined) ?? bankCode;

    const created = await gc<Created>("/v1/cashouts", {
      method: "POST",
      idempotencyKey: `gd_${attemptKey}`.slice(0, 64),
      body: {
        wallet, amountG,
        recipient: { bankCode, accountNumber, accountName },
        partnerRef: `gd_${attemptKey}`.slice(0, 64),
        feePercentShown,
      },
      timeoutMs: 25_000,
    });
    if (!created.ok) return fail(created.error.message, created.error.status, created.error.code);
    const c = created.data;

    // Check it here too (the app checks again before the wallet signs).
    const check = checkCashOutTx(c.transaction, c.order, amountWei, { testMode: gcConfig()!.mode === "test" });
    if (!check.ok) {
      console.error(`[cashout] refused GoodCash transaction for ${c.id}: ${check.reason}`);
      return fail("Something didn't look right with this withdrawal, so we stopped it. Nothing was sent. Please try again.", 502, "unsafe_transaction");
    }

    const day = lagosDay();
    const naira = typeof c.receive?.naira === "number" ? c.receive.naira : 0;
    await saveOrder(s, {
      id: c.id, wallet: wallet.toLowerCase(), root, day, amountG, amountWei: amountWei.toString(), naira,
      nairaPerDollar: quote.ok ? quote.data.nairaPerDollar : 0,
      accountName, bankName, accountLast4: accountNumber.slice(-4), createdAt: c.createdAt ?? new Date().toISOString(),
    });
    await markDay(s, root, day, c.id, amountWei.toString(), Date.parse(c.order.validUntil) || Date.now() + 15 * 60_000, "awaiting_signature");

    return NextResponse.json({
      mode: gcConfig()!.mode,
      cashOut: toView(c, { accountName, bankName, accountLast4: accountNumber.slice(-4), naira }),
      fees: c.fees ?? [],
      transaction: c.transaction,
      order: c.order,
    }, { status: 201, headers: NO_STORE });
  });

  if (result === "busy") return fail("Your last withdrawal is still being set up. Give it a few seconds.", 409, "busy");
  return result;
}

// GET /api/cashout?wallet=0x… → recent cash outs for this wallet (amounts and
// status only: bank details never leave our server in a list).
export async function GET(req: NextRequest) {
  if (!cashOutEnabled()) return NextResponse.json({ data: [] });
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (!ADDR_RE.test(wallet)) return fail("Invalid wallet", 400);
  const r = await gc<{ data: GcCashOut[] }>(`/v1/cashouts?wallet=${wallet}&limit=20`);
  if (!r.ok) return fail(r.error.message, r.error.status, r.error.code);
  return NextResponse.json({ data: (r.data.data ?? []).map((c) => toView(c, null)) }, { headers: NO_STORE });
}
