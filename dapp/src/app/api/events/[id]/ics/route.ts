import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { getEvent } from "@/lib/eventStore";
import { isEventId } from "@/lib/events";
import { buildIcs } from "@/components/events/ics";

export const runtime = "nodejs";

/**
 * GET /api/events/:id/ics — the event as a calendar file. A real link (not a
 * blob made in the page) so "Add to calendar" also works inside wallet apps'
 * browsers, which ignore downloads created by script.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isEventId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const e = await getEvent(redis, id);
  if (!e || e.status !== "approved") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = `${req.nextUrl.origin}/events/${e.id}`;
  const name = e.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "event";
  return new NextResponse(buildIcs({ ...e, url }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${name}.ics"`,
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
