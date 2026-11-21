import { NextRequest, NextResponse } from "next/server";
import { cashOutEnabled, gc, getOrder, store, syncCashOut, toView, ID_RE, type GcCashOut } from "@/lib/goodcashServer";

export const runtime = "nodejs";

// GET /api/cashout/:id → the cash out's current status, read from GoodCash with
// our secret key. Also brings our records up to date (the daily cap, and the
// central total once it's paid), so we never depend on the webhook alone.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!cashOutEnabled()) return NextResponse.json({ error: "Withdrawals aren't available yet." }, { status: 404 });
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await gc<GcCashOut>(`/v1/cashouts/${id}`);
  if (!r.ok) return NextResponse.json({ error: r.error.message, code: r.error.code }, { status: r.error.status });
  const s = store();
  const o = s ? await syncCashOut(s, r.data).catch(() => null) ?? await getOrder(s, id).catch(() => null) : null;
  return NextResponse.json({ cashOut: toView(r.data, o) }, { headers: { "Cache-Control": "private, no-store" } });
}
