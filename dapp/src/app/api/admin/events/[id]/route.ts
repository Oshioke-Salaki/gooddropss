import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getEvent, saveEvent } from "@/lib/eventStore";
import { sendPush } from "@/lib/push";
import { eventPhase, isEventId, type GdEvent } from "@/lib/events";

export const runtime = "nodejs";

type Action = "approve" | "reject" | "approveEdit" | "rejectEdit" | "remove";

/**
 * POST /api/admin/events/:id  { action, reason? }
 *
 *  approve      pending  → approved (goes public)
 *  reject       pending  → rejected (reason shown to the organizer)
 *  approveEdit  applies an approved event's pending edit
 *  rejectEdit   drops a pending edit (the live version is untouched)
 *  remove       approved → rejected: takes a live event down
 *
 * Every outcome is pushed to the organizer, so nobody has to keep checking.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const { id } = await params;
  if (!isEventId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: { action?: Action; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const reason = (body.reason ?? "").trim().slice(0, 300);

  const e = await getEvent(redis, id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = Math.floor(Date.now() / 1000);

  let next: GdEvent;
  let push: { title: string; body: string } | null = null;
  switch (body.action) {
    case "approve":
      if (e.status !== "pending") return conflict("Only pending events can be approved.");
      if (eventPhase(e, now) === "ended") return conflict("This event has already ended.");
      next = { ...e, status: "approved", approvedAt: now, updatedAt: now, rejectReason: undefined };
      push = { title: "Your event is live", body: `${e.title} is approved and visible to hunters. Add your drops now.` };
      break;
    case "reject":
      if (e.status !== "pending") return conflict("Only pending events can be rejected.");
      if (!reason) return conflict("Give the organizer a reason.");
      next = { ...e, status: "rejected", rejectReason: reason, updatedAt: now };
      push = { title: "Your event needs changes", body: `${e.title}: ${reason}` };
      break;
    case "approveEdit":
      if (!e.pendingEdit) return conflict("There's no pending edit.");
      next = { ...e, ...e.pendingEdit, pendingEdit: null, updatedAt: now };
      push = { title: "Your event changes are live", body: `${e.pendingEdit.title} is updated.` };
      break;
    case "rejectEdit":
      if (!e.pendingEdit) return conflict("There's no pending edit.");
      if (!reason) return conflict("Give the organizer a reason.");
      next = { ...e, pendingEdit: null, rejectReason: `Edit not approved: ${reason}`, updatedAt: now };
      push = { title: "Your event changes weren't approved", body: `${e.title}: ${reason}` };
      break;
    case "remove":
      if (e.status !== "approved") return conflict("Only live events can be removed.");
      if (!reason) return conflict("Give the organizer a reason.");
      next = { ...e, status: "rejected", rejectReason: `Removed: ${reason}`, pendingEdit: null, updatedAt: now };
      push = { title: "Your event was taken down", body: `${e.title}: ${reason}` };
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  await saveEvent(redis, next, e);
  if (push) {
    // Best effort: a missing subscription must never fail the review.
    sendPush(redis, e.organizer, { ...push, url: `/events/${id}`, tag: `event-${id}` }).catch(() => {});
  }
  return NextResponse.json({ event: next });
}

function conflict(error: string) {
  return NextResponse.json({ error }, { status: 409 });
}
