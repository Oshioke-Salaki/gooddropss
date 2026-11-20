import { NextRequest, NextResponse } from "next/server";
import { cashOutEnabled, gc, store, underLimit, ACCOUNT_RE } from "@/lib/goodcashServer";
import { clientIp } from "@/lib/eventAuth";

export const runtime = "nodejs";

// POST /api/cashout/verify { bankCode, accountNumber } → { accountName }
// The bank's own name for the account, shown before anyone confirms. Rate
// limited per IP: an open name lookup is something people would abuse.
export async function POST(req: NextRequest) {
  if (!cashOutEnabled()) return NextResponse.json({ error: "Cash out isn't available yet." }, { status: 404 });
  let body: { bankCode?: unknown; accountNumber?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const bankCode = typeof body.bankCode === "string" ? body.bankCode.trim() : "";
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
  if (!bankCode || bankCode.length > 20 || !ACCOUNT_RE.test(accountNumber)) {
    return NextResponse.json({ error: "Enter your 10-digit account number.", code: "invalid_request" }, { status: 400 });
  }

  const s = store();
  if (s && !(await underLimit(s, "verify", clientIp(req.headers), 30, 600))) {
    return NextResponse.json({ error: "Too many checks. Wait a few minutes and try again.", code: "rate_limited" }, { status: 429 });
  }

  const r = await gc<{ accountName?: string }>("/v1/banks/verify", { method: "POST", body: { bankCode, accountNumber } });
  if (!r.ok) {
    const msg = r.error.code === "bank_account_not_found"
      ? "We couldn't find that account. Check the bank and the number."
      : r.error.message;
    return NextResponse.json({ error: msg, code: r.error.code }, { status: r.error.status });
  }
  if (!r.data.accountName) return NextResponse.json({ error: "We couldn't find that account. Check the bank and the number.", code: "bank_account_not_found" }, { status: 400 });
  return NextResponse.json({ accountName: r.data.accountName }, { headers: { "Cache-Control": "no-store" } });
}
