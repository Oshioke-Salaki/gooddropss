import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { getSpots } from "@/lib/spotStore";
import { getEvents } from "@/lib/eventStore";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/switch/holdings?address=0x…
//
// What a wallet runs on GoodDrops that is tied to that exact address (not to the
// person), so the switch-to-email page can say what stays with the old wallet:
// shops it registered and events it organizes or co-hosts. Counts only, nothing
// private.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase() ?? "";
  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "valid address required" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    const [spotIds, eventIds] = await Promise.all([
      redis.smembers<string[]>(keys.spotsByOwner(address)),
      redis.smembers<string[]>(keys.eventsByHost(address)),
    ]);
    const [spots, events] = await Promise.all([
      spotIds?.length ? getSpots(redis, spotIds) : Promise.resolve([]),
      eventIds?.length ? getEvents(redis, eventIds) : Promise.resolve([]),
    ]);
    const now = Math.floor(Date.now() / 1000);
    const shops = spots.filter((s) => s.status !== "rejected").length;
    const shopsPayHere = spots.filter((s) => s.status !== "rejected" && s.wallet?.toLowerCase() === address).length;
    const live = events.filter((e) => (e.status === "approved" || e.status === "pending") && e.endsAt > now);
    return NextResponse.json({
      shops,
      shopsPayHere,
      eventsOrganized: live.filter((e) => e.organizer === address).length,
      eventsCohosted: live.filter((e) => e.organizer !== address).length,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[switch/holdings]", e);
    return NextResponse.json({ error: "Couldn't load" }, { status: 500 });
  }
}
