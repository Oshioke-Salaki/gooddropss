import { NextRequest, NextResponse } from "next/server";
import { cashOutEnabled, gc, store, syncCashOut, toView, ID_RE, TX_RE, type GcCashOut } from "@/lib/goodcashServer";

export const runtime = "nodejs";

// POST /api/cashout/:id/tx { txHash } → tell GoodCash which transaction paid this
// cash out. GoodCash checks it on chain (it looks for its router's payment from
// this wallet, so sponsored sends match too). 202 means "not mined yet": the app
// reports again in a few seconds.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!cashOutEnabled()) return NextResponse.json({ error: "Withdrawals aren't available yet." }, { status: 404 });
  const { id } = await params;
  let body: { txHash?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const txHash = typeof body.txHash === "string" ? body.txHash : "";
  if (!ID_RE.test(id) || !TX_RE.test(txHash)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const r = await gc<GcCashOut>(`/v1/cashouts/${id}/transaction`, { method: "POST", body: { txHash }, timeoutMs: 25_000 });
  if (!r.ok) return NextResponse.json({ error: r.error.message, code: r.error.code }, { status: r.error.status });
  const s = store();
  const o = s ? await syncCashOut(s, r.data).catch(() => null) : null;
  return NextResponse.json({ cashOut: toView(r.data, o), linked: r.status === 200 }, { status: r.status === 202 ? 202 : 200 });
}
