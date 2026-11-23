import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { REF_ADDR_RE } from "@/lib/referral";
import { settleInvite } from "@/lib/referralLedger";
import { ledgerDeps } from "@/lib/referralDeps";
import { clientIp } from "@/lib/eventAuth";
import { overLimit } from "@/lib/referralRateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/referral/settle  { invitee } → InviteResult
// Re-check a wallet's saved invite and count it if it now qualifies (verified,
// has claimed or hidden a drop). Needs no signature: it can only act on an
// invite the invitee already signed, and every rule is re-checked here.
// The invitee's app calls it after a claim; the sweep cron covers everyone else.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { invitee?: unknown } | null;
  const invitee = body?.invitee;
  if (typeof invitee !== "string" || !REF_ADDR_RE.test(invitee))
    return NextResponse.json({ error: "valid invitee required" }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  if (await overLimit(redis, "settle", clientIp(req.headers), 240, 600))
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });

  const result = await settleInvite(redis, invitee, ledgerDeps());
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
