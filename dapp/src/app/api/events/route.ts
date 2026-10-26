import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { getEvents, saveEvent, statsFor } from "@/lib/eventStore";
import { verifyEventSignature } from "@/lib/eventAuth";
import {
  LIMITS, eventPhase, newEventId, publicEvent, statsToJson, validateDraft, type GdEvent,
} from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 30;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * GET /api/events                → public events: { live, upcoming, past }, each with live stats
 * GET /api/events?host=0x…       → every event that wallet organizes or co-hosts, any status
 *
 * The public list is CDN-cached briefly; the host list never is (organizers
 * check it right after submitting).
 */
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const now = Math.floor(Date.now() / 1000);
  const host = req.nextUrl.searchParams.get("host")?.toLowerCase();

  try {
    if (host) {
      if (!ADDR_RE.test(host)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
      const ids = await redis.smembers(keys.eventsByHost(host));
      const events = (await getEvents(redis, ids)).sort((a, b) => b.createdAt - a.createdAt);
      const stats = await statsFor(events, now);
      return NextResponse.json(
        { events: events.map((e) => ({ event: publicEvent(e, host), stats: statsToJson(stats.get(e.id)!) })) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    // Approved events from 30 days back onward (past ones beyond that drop off the list).
    const ids = await redis.zrange<string[]>(keys.eventsPublic(), now - 37 * 86_400, "+inf", { byScore: true });
    const events = (await getEvents(redis, ids)).filter((e) => e.status === "approved");
    const [stats, interested] = await Promise.all([
      statsFor(events, now),
      events.length
        ? (async () => { const p = redis.pipeline(); for (const e of events) p.scard(keys.eventInterested(e.id)); return (await p.exec()) as number[]; })()
        : Promise.resolve([] as number[]),
    ]);

    const row = (e: GdEvent, i: number) => ({
      event: publicEvent(e), stats: statsToJson(stats.get(e.id)!), interested: Number(interested[i] ?? 0),
    });
    const rows = events.map(row);
    const live = rows.filter((r) => eventPhase(r.event, now) === "live").sort((a, b) => a.event.endsAt - b.event.endsAt);
    const upcoming = rows.filter((r) => eventPhase(r.event, now) === "upcoming").sort((a, b) => a.event.startsAt - b.event.startsAt);
    const past = rows
      .filter((r) => eventPhase(r.event, now) === "ended" && r.event.endsAt > now - 30 * 86_400)
      .sort((a, b) => b.event.endsAt - a.event.endsAt)
      .slice(0, 30);

    return NextResponse.json(
      { live, upcoming, past, at: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch (e) {
    console.error("[events/get]", e);
    return NextResponse.json({ error: "Couldn't load events" }, { status: 502 });
  }
}

/**
 * POST /api/events — submit a new event for review.
 * Body: { draft, address, signature, timestamp }. The signature covers the
 * normalised draft (see lib/events eventMessage), so what's reviewed is
 * exactly what the organizer signed.
 */
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }

  const now = Math.floor(Date.now() / 1000);
  const organizer = typeof body.address === "string" ? body.address.toLowerCase() : "";
  const v = validateDraft(body.draft, now, { organizer });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const sigErr = await verifyEventSignature(redis, {
    address: body.address, signature: body.signature, timestamp: body.timestamp,
    action: "create", eventId: "new", draft: v.value,
  });
  if (sigErr) return NextResponse.json({ error: sigErr }, { status: 401 });

  // Abuse limits: a handful of open events per organizer, and a daily cap on submissions.
  const mine = await getEvents(redis, await redis.smembers(keys.eventsByHost(organizer)));
  const open = mine.filter((e) => e.organizer === organizer && (e.status === "pending" || (e.status === "approved" && e.endsAt > now)));
  if (open.length >= LIMITS.maxOpenPerOrganizer) {
    return NextResponse.json({ error: `You can have ${LIMITS.maxOpenPerOrganizer} events pending or upcoming at a time.` }, { status: 429 });
  }
  const daily = await redis.incr(keys.eventCreateRl(organizer));
  if (daily === 1) await redis.expire(keys.eventCreateRl(organizer), 86_400);
  if (daily > 10) return NextResponse.json({ error: "Too many submissions today — try again tomorrow." }, { status: 429 });

  const event: GdEvent = {
    ...v.value, id: newEventId(), organizer, status: "pending", createdAt: now, updatedAt: now, pendingEdit: null,
  };
  await saveEvent(redis, event);
  return NextResponse.json({ event }, { status: 201 });
}
