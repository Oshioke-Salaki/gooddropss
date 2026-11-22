import { NextRequest, NextResponse } from "next/server";
import { fetchHasActivity } from "@/lib/subgraph";

export const runtime = "nodejs";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * GET /api/referral/activity?address=0x… → { active } — has this wallet claimed
 * or created a drop? Lets an invitee's app credit their referrer as soon as they
 * qualify. Advisory only: POST /api/referral re-checks before crediting.
 * 503 when it can't tell (never a false "no").
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !ADDR_RE.test(address)) return NextResponse.json({ error: "valid address required" }, { status: 400 });
  try {
    const active = await fetchHasActivity(address);
    return NextResponse.json({ active }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't check right now" }, { status: 503 });
  }
}
