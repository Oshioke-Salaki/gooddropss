import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";

export const runtime = "nodejs";

// POST /api/push/subscribe
// Body: { subscription: PushSubscription, address: string }
export async function POST(req: NextRequest) {
  try {
    const { subscription, address } = await req.json();
    if (!subscription?.endpoint || !address) {
      return NextResponse.json({ error: "Missing subscription or address" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) {
      // Upstash not configured — acknowledge without storing
      return NextResponse.json({ ok: true, stored: false });
    }

    await redis.set(keys.subscription(address), JSON.stringify(subscription), { ex: 60 * 60 * 24 * 90 }); // 90 days TTL
    await redis.sadd(keys.subscribersIndex(), address.toLowerCase()); // enumerable for background jobs
    return NextResponse.json({ ok: true, stored: true });
  } catch (e) {
    console.error("[push/subscribe]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// DELETE /api/push/subscribe
// Body: { address: string }
export async function DELETE(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (!address) return NextResponse.json({ error: "Missing address" }, { status: 400 });

    const redis = getRedis();
    if (redis) {
      await redis.del(keys.subscription(address));
      await redis.srem(keys.subscribersIndex(), address.toLowerCase());
      await redis.hdel(keys.huntersLoc(), address.toLowerCase()); // stop nearby alerts too
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push/unsubscribe]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
