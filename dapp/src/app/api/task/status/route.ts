import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/task/status?dropId=&address=
// The hunter polls this after showing their QR: once the merchant approves, it
// returns { approved: true } and the app moves to the normal claim.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ approved: false, reason: "storage_unavailable" });

  const dropId = req.nextUrl.searchParams.get("dropId") ?? "";
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  if (!/^\d+$/.test(dropId) || !ADDR_RE.test(address)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const root = (await resolveIdentityRoot(address)).toLowerCase();
  const approved = await redis.get(keys.taskApproval(dropId, root));
  return NextResponse.json({ approved: !!approved });
}
