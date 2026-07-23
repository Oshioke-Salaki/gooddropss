import { NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";

export const runtime = "nodejs";

// GET /api/moderation/hidden — public. The list of drop ids admins have hidden
// from the map (offensive/scam). Not sensitive: it's exactly what every visitor's
// map already reflects. The map fetches this and filters those drops out.
export async function GET() {
  try {
    const redis = getRedis();
    if (!redis) return NextResponse.json({ hidden: [] });
    const hidden = await redis.smembers(keys.hiddenDrops());
    return NextResponse.json({ hidden: hidden ?? [] });
  } catch (e) {
    console.error("[moderation/hidden]", e);
    return NextResponse.json({ hidden: [] });
  }
}
