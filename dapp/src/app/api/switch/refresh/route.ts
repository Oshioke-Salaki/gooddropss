import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { refreshIdentityRoot } from "@/lib/identityRoot";
import { clientIp } from "@/lib/eventAuth";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const PER_HOUR = 30;

// POST /api/switch/refresh { address }
//
// After the switch-to-email page links a wallet, this re-reads that wallet's
// GoodDollar root from the chain and overwrites the cached one, so rankings,
// streaks and the profile merge straight away instead of after the cache expires.
// No signature: it can only ever write the true on-chain value. Rate-limited per
// IP because each call is one RPC read.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const address = typeof body?.address === "string" ? body.address : "";
  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "valid address required" }, { status: 400 });

  const redis = getRedis();
  if (redis) {
    const key = `gd:switch:rl:${clientIp(req.headers)}`;
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, 3600);
      if (n > PER_HOUR) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    } catch { /* limiter is best-effort */ }
  }

  const root = await refreshIdentityRoot(address);
  if (!root) return NextResponse.json({ error: "Couldn't reach the network" }, { status: 502 });
  return NextResponse.json({ root }, { headers: { "Cache-Control": "no-store" } });
}
