import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { cashOutHealth, cashOutPaused, connectWebhook, gcConfig, setCashOutPaused, store, totals } from "@/lib/goodcashServer";

export const runtime = "nodejs";

const WEBHOOK_URL = "https://www.gooddrops.xyz/api/goodcash/webhook";

// GET /api/admin/cashouts → the central cash-out figure (everything our users have
// cashed out, in G$ and in naira at the time of each cash out) plus a health check.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = gcConfig();
  const s = store();
  if (!cfg || !s) return NextResponse.json({ configured: false });
  const [t, health, paused] = await Promise.all([totals(s, 50), cashOutHealth(), cashOutPaused()]);
  return NextResponse.json({ configured: true, mode: cfg.mode, paused, ...t, health }, { headers: { "Cache-Control": "private, no-store" } });
}

// POST /api/admin/cashouts { action: "connect-webhook" } → register our webhook
// with GoodCash using the server's own key; the signing secret never leaves the server.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  // Pause or resume withdrawals (GoodCash maintenance). Ones already under way finish either way.
  if (body.action === "pause" || body.action === "resume") {
    try { await setCashOutPaused(body.action === "pause"); }
    catch { return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 503 }); }
    return NextResponse.json({ ok: true, paused: body.action === "pause" });
  }
  if (body.action !== "connect-webhook") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const r = await connectWebhook(WEBHOOK_URL);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
