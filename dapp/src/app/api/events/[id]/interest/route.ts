import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { getEvent } from "@/lib/eventStore";
import { clientIp } from "@/lib/eventAuth";
import { eventPhase, isEventId } from "@/lib/events";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const PER_IP_PER_HOUR = 60;

/**
 * POST /api/events/:id/interest  { address, on: boolean }
 *
 * "Remind me" — the wallet gets a push about an hour before the start (if it
 * has notifications on). Deliberately signature-free: it's a reminder, not a
 * ticket, so the count is labelled "interested", never "attending", and a
 * per-IP limit keeps it from being pumped.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isEventId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: { address?: unknown; on?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const address = typeof body.address === "string" ? body.address.toLowerCase() : "";
  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const e = await getEvent(redis, id);
  if (!e || e.status !== "approved") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (eventPhase(e, Math.floor(Date.now() / 1000)) === "ended") {
    return NextResponse.json({ error: "This event has ended." }, { status: 409 });
  }

  const rl = keys.eventInterestRl(clientIp(req.headers));
  const n = await redis.incr(rl);
  if (n === 1) await redis.expire(rl, 3600);
  if (n > PER_IP_PER_HOUR) return NextResponse.json({ error: "Slow down a little." }, { status: 429 });

  if (body.on === false) await redis.srem(keys.eventInterested(id), address);
  else await redis.sadd(keys.eventInterested(id), address);
  const count = await redis.scard(keys.eventInterested(id));
  return NextResponse.json({ on: body.on !== false, interested: count });
}
