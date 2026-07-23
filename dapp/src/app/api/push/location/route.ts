import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// Store location coarsened to ~3 decimal places (~110 m) — enough for a "drop
// near you" radius, never a precise fix. Privacy by design.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// POST /api/push/location — a subscribed hunter shares a coarse location so we
// can alert them when a drop appears nearby. Body: { address, lat, lng }
export async function POST(req: NextRequest) {
  try {
    const { address, lat, lng } = await req.json();
    if (typeof address !== "string" || !ADDR_RE.test(address))
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    if (typeof lat !== "number" || typeof lng !== "number" ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0))
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ ok: true, stored: false });

    const now = Math.floor(Date.now() / 1000);
    await redis.hset(keys.huntersLoc(), {
      [address.toLowerCase()]: `${round3(lat)},${round3(lng)},${now}`,
    });
    return NextResponse.json({ ok: true, stored: true });
  } catch (e) {
    console.error("[push/location/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// DELETE /api/push/location — stop sharing location (opt out of nearby alerts).
export async function DELETE(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (typeof address !== "string" || !ADDR_RE.test(address))
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    const redis = getRedis();
    if (redis) await redis.hdel(keys.huntersLoc(), address.toLowerCase());
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push/location/delete]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
