import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { getEvent, saveEvent, statsFor } from "@/lib/eventStore";
import { verifyEventSignature } from "@/lib/eventAuth";
import { isAdminAuthed } from "@/lib/adminAuth";
import {
  eventPhase, hostsOf, isEventId, publicEvent, statsToJson, validateDraft, type GdEvent,
} from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 30;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/events/:id[?viewer=0x…] — the event, its live stats, how many people
 * asked to be reminded, and whether the viewer is one of them / a host.
 * Unapproved events are only visible to their hosts and admins.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isEventId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const e = await getEvent(redis, id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const viewer = req.nextUrl.searchParams.get("viewer")?.toLowerCase() ?? null;
  const isHost = !!viewer && ADDR_RE.test(viewer) && hostsOf(e).has(viewer);
  const visible = e.status === "approved" || e.status === "cancelled" || isHost || (await isAdminAuthed());
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  const [stats, interested, mine] = await Promise.all([
    statsFor([e], now),
    redis.scard(keys.eventInterested(id)),
    viewer && ADDR_RE.test(viewer) ? redis.sismember(keys.eventInterested(id), viewer) : Promise.resolve(0),
  ]);

  return NextResponse.json(
    {
      event: publicEvent(e, viewer), stats: statsToJson(stats.get(id)!), interested,
      viewer: { isHost, isOrganizer: viewer === e.organizer, interested: !!mine },
      phase: eventPhase(e, now), at: Date.now(),
    },
    // Personalised when a viewer is given; otherwise a short shared cache.
    { headers: { "Cache-Control": viewer ? "private, no-store" : "public, s-maxage=10, stale-while-revalidate=30" } },
  );
}

/**
 * PATCH /api/events/:id — the organizer edits or cancels.
 * Body: { action: "edit" | "cancel", draft?, address, signature, timestamp }
 *
 *  • Pending / rejected → the edit replaces the submission and goes (back) to review.
 *  • Approved → the edit waits in `pendingEdit`; the approved version stays live.
 *  • Ended or cancelled events can't be changed.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isEventId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }

  const e = await getEvent(redis, id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const address = typeof body.address === "string" ? body.address.toLowerCase() : "";
  if (address !== e.organizer) return NextResponse.json({ error: "Only the organizer can change this event." }, { status: 403 });

  const now = Math.floor(Date.now() / 1000);
  if (e.status === "cancelled") return NextResponse.json({ error: "This event was cancelled." }, { status: 409 });
  if (e.status === "approved" && eventPhase(e, now) === "ended") {
    return NextResponse.json({ error: "This event has ended and can't be changed." }, { status: 409 });
  }

  const action = body.action;
  if (action === "cancel") {
    const sigErr = await verifyEventSignature(redis, { ...sigFields(body), action: "cancel", eventId: id, draft: null });
    if (sigErr) return NextResponse.json({ error: sigErr }, { status: 401 });
    const next: GdEvent = { ...e, status: "cancelled", cancelledAt: now, updatedAt: now, pendingEdit: null };
    await saveEvent(redis, next, e);
    return NextResponse.json({ event: next });
  }

  if (action !== "edit") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  // A live event can still be edited (e.g. extend the end), so its past start is fine.
  const v = validateDraft(body.draft, now, { organizer: e.organizer, allowStarted: e.status === "approved" && now >= e.startsAt });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const sigErr = await verifyEventSignature(redis, { ...sigFields(body), action: "edit", eventId: id, draft: v.value });
  if (sigErr) return NextResponse.json({ error: sigErr }, { status: 401 });

  const next: GdEvent = e.status === "approved"
    ? { ...e, pendingEdit: v.value, updatedAt: now }
    : { ...e, ...v.value, status: "pending", rejectReason: undefined, pendingEdit: null, updatedAt: now };
  await saveEvent(redis, next, e);
  return NextResponse.json({ event: next });
}

function sigFields(b: Record<string, unknown>) {
  return { address: b.address, signature: b.signature, timestamp: b.timestamp };
}
