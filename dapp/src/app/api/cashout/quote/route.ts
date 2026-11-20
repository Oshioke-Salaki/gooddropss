import { NextRequest, NextResponse } from "next/server";
import { cashOutEnabled, gc, AMOUNT_RE } from "@/lib/goodcashServer";
import type { Quote } from "@/lib/goodcash";

export const runtime = "nodejs";

// GET /api/cashout/quote?amountG=5000 → what the person gets in naira, every fee
// on its own line. Shown as is: we never work fees out ourselves.
export async function GET(req: NextRequest) {
  if (!cashOutEnabled()) return NextResponse.json({ error: "Cash out isn't available yet." }, { status: 404 });
  const amountG = req.nextUrl.searchParams.get("amountG") ?? "";
  if (!AMOUNT_RE.test(amountG) || Number(amountG) <= 0) {
    return NextResponse.json({ error: "Enter an amount.", code: "invalid_request" }, { status: 400 });
  }
  const r = await gc<Quote>(`/v1/quote?amountG=${encodeURIComponent(amountG)}`);
  if (!r.ok) return NextResponse.json({ error: r.error.message, code: r.error.code }, { status: r.error.status });
  const q = r.data;
  return NextResponse.json({
    amountG: q.amountG, receive: q.receive, feePercent: q.feePercent, fees: q.fees,
    minimumG: q.minimumG, enough: q.enough, nairaPerDollar: q.nairaPerDollar, expiresAt: q.expiresAt,
  } satisfies Quote, { headers: { "Cache-Control": "no-store" } });
}
