import { NextRequest, NextResponse } from "next/server";
import { cashOutEnabled, gc, gcConfig, store, syncCashOut, toView, ID_RE, type GcCashOut } from "@/lib/goodcashServer";

export const runtime = "nodejs";

// POST /api/cashout/:id/simulate → TEST KEYS ONLY. Stands in for the wallet
// sending the transaction: GoodCash moves it to processing, then to its outcome,
// without any money or chain involved.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!cashOutEnabled() || gcConfig()?.mode !== "test") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await gc<GcCashOut>(`/v1/test/cashouts/${id}/simulate`, { method: "POST" });
  if (!r.ok) return NextResponse.json({ error: r.error.message, code: r.error.code }, { status: r.error.status });
  const s = store();
  const o = s ? await syncCashOut(s, r.data).catch(() => null) : null;
  return NextResponse.json({ cashOut: toView(r.data, o) });
}
