import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { gcConfig, store, totals } from "@/lib/goodcashServer";

export const runtime = "nodejs";

// GET /api/admin/cashouts → the central cash-out figure: everything our users have
// cashed out to their banks, in G$ and in naira at the time of each cash out.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = gcConfig();
  const s = store();
  if (!cfg || !s) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, mode: cfg.mode, ...(await totals(s, 50)) }, { headers: { "Cache-Control": "private, no-store" } });
}
