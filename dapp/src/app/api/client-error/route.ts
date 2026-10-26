import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

// Per-IP budget so a broken page (or someone poking the endpoint) can't flood
// the logs. Counted per minute with a TTL'd key; fails open if Redis is down,
// because losing an error report is worse than an extra log line.
const PER_MINUTE = 20;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

// POST /api/client-error — browser error reports from lib/clientErrors.
// Writes one structured line to the function log; stores nothing.
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4000) return new NextResponse(null, { status: 413 });
    b = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const message = str(b.message, 300);
  if (!message) return new NextResponse(null, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const redis = getRedis();
  if (redis) {
    try {
      const key = `gd:clienterr:ip:${ip}:${Math.floor(Date.now() / 60_000)}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, 120);
      if (n > PER_MINUTE) return new NextResponse(null, { status: 429 });
    } catch { /* fail open */ }
  }

  console.error("[client-error]", JSON.stringify({
    source: str(b.source, 40),
    message,
    path: str(b.path, 200),
    digest: str(b.digest, 64),
    build: str(b.build, 64),
    ua: str(b.ua, 200),
    stack: str(b.stack, 900),
  }));
  return new NextResponse(null, { status: 204 });
}
