import { NextRequest, NextResponse } from "next/server";
import { runRefPayout } from "@/lib/refPayout";
import { isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const maxDuration = 60; // room to confirm several transfers per sweep

// The REFERRAL competition's payout sweep. Three callers:
//   • Vercel Cron (GET, Authorization: Bearer CRON_SECRET) — the daily safety net,
//     which settles anything an inline attempt missed (wallet was short, RPC blip).
//   • Admin "Pay now" (POST, admin cookie) — a manual sweep, e.g. after refilling.
//   • /api/referral and /api/comp/credit fire it inline, so a payout lands within
//     seconds of someone crossing the threshold rather than waiting for the cron.
//
// NOTE: vercel.json has pointed a daily cron at this path since the referral
// competition shipped. The handler was deleted when payouts moved to a manual
// script, and the cron entry was left behind — so it 404'd every day until this
// route came back. If payouts ever move away from here again, remove the cron too.
function cronAuthed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — never an open money endpoint
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!cronAuthed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runRefPayout());
}

export async function POST(req: NextRequest) {
  if (!cronAuthed(req) && !(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runRefPayout());
}
