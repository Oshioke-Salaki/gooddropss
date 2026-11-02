import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { getEvent, hostDropsFor } from "@/lib/eventStore";
import { eventClaimGate, isEventId } from "@/lib/events";
import { gpsToDeg } from "@/lib/utils";
import { DROP_STATUS } from "@/types";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/events/:id/drops
 *   → { live: [{ lat, lng, amountWei }] } the event's claimable drops, for its
 *     map. Empty whenever they're locked (before the start, after the end, or
 *     cancelled), so this never reveals where drops are waiting.
 *
 * GET /api/events/:id/drops?dropper=0x…
 *   → { mine: [{ id, amountWei, expiry }] } that host's unclaimed drops for the
 *     event, so they can take back what's left. No locations.
 *
 * Small and CDN-cached, so a room full of phones polling it is cheap.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isEventId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const e = await getEvent(redis, id);
  if (!e || (e.status !== "approved" && e.status !== "cancelled")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  try {
    const drops = await hostDropsFor(e);
    const dropper = req.nextUrl.searchParams.get("dropper")?.toLowerCase();
    if (dropper) {
      if (!ADDR_RE.test(dropper)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
      const mine = drops
        .filter((d) => d.dropper.toLowerCase() === dropper && d.status === DROP_STATUS.Active)
        .map((d) => ({ id: d.id.toString(), amountWei: d.amount.toString(), expiry: d.expiry }))
        .sort((a, b) => a.expiry - b.expiry);
      return NextResponse.json({ mine, at: Date.now() }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const open = drops.length > 0 && !eventClaimGate(e, drops[0].dropper, now).locked;
    const live = open
      ? drops
        .filter((d) => d.status === DROP_STATUS.Active && d.expiry > now)
        .map((d) => ({ lat: gpsToDeg(d.lat), lng: gpsToDeg(d.lng), amountWei: d.amount.toString() }))
      : [];
    return NextResponse.json(
      { live, at: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } },
    );
  } catch (err) {
    console.error("[events/drops]", err);
    return NextResponse.json({ error: "Couldn't load drops" }, { status: 502 });
  }
}
