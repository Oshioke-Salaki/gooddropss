import { NextResponse } from "next/server";
import { fetchAllDrops } from "@/lib/subgraph";
import { memo } from "@/lib/serverCache";
import { DROP_STATUS } from "@/types";
import { gpsToDeg } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * GET /api/drops/heat — where hunters have claimed drops, for the map's demand
 * heatmap. Only coordinates (rounded to ~100 m, which is all a heatmap needs and
 * avoids pinpointing anyone), fetched only when the heatmap is switched on.
 */
export async function GET() {
  try {
    const points = await memo("drops:heat", 10 * 60_000, async () => {
      const drops = await fetchAllDrops();
      const out: [number, number][] = [];
      for (const d of drops) {
        if (d.status !== DROP_STATUS.Claimed) continue;
        const lat = gpsToDeg(d.lat), lng = gpsToDeg(d.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
        out.push([Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000]);
      }
      return out;
    });
    return NextResponse.json(
      { points },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
    );
  } catch (e) {
    console.error("[drops/heat]", e);
    return NextResponse.json({ points: [] }, { status: 502 });
  }
}
