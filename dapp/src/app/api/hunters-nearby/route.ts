import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { haversineDistance } from "@/lib/utils";

export const runtime = "nodejs";

// Aggregate-only urgency signal. Counts opted-in hunters whose COARSE (~110 m)
// shared location is within a generous radius of a point, from the same data the
// nearby-push feature uses. It returns a COUNT and nothing else — never who,
// never an exact position — so it creates FOMO without ever exposing a person's
// whereabouts (the reason we don't plot hunters on the map).
const RADIUS_M  = 2500;
const FRESH_S   = 3 * 24 * 60 * 60;

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  const exclude = (req.nextUrl.searchParams.get("exclude") ?? "").toLowerCase();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ count: 0 });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ count: 0 });

  try {
    const all = (await redis.hgetall<Record<string, string>>(keys.huntersLoc())) ?? {};
    const now = Math.floor(Date.now() / 1000);
    let count = 0;
    for (const [addr, raw] of Object.entries(all)) {
      if (addr === exclude) continue;
      const [hlat, hlng, ts] = String(raw).split(",");
      const la = Number(hlat), ln = Number(hlng), t = Number(ts);
      if (!Number.isFinite(la) || !Number.isFinite(ln) || !Number.isFinite(t)) continue;
      if (now - t > FRESH_S) continue;
      if (haversineDistance(lat, lng, la, ln) <= RADIUS_M) count++;
    }
    // Never respond with a real-time cacheable value that could be diffed to
    // deanonymise; keep it uncached and coarse.
    return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[hunters-nearby]", e);
    return NextResponse.json({ count: 0 });
  }
}
