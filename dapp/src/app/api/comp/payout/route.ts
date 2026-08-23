import { NextRequest, NextResponse } from "next/server";
import { runCompPayout } from "@/lib/compPayout";
import { isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const maxDuration = 60; // room to confirm several transfers per sweep

// Runs the payout sweep. Two callers:
//   • Vercel Cron (GET, Authorization: Bearer CRON_SECRET) — the daily safety net.
//   • Admin "Pay now" (POST, admin cookie) — manual sweep after refilling the wallet.
// It's also fired opportunistically from /api/referral so payouts land promptly.
function cronAuthed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!cronAuthed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runCompPayout());
}

export async function POST(req: NextRequest) {
  if (!cronAuthed(req) && !(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runCompPayout());
}
