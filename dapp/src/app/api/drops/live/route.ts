import { NextRequest, NextResponse } from "next/server";
import { fetchLiveDrops } from "@/lib/subgraph";
import { memo } from "@/lib/serverCache";
import { toDropJson } from "@/lib/dropJson";
import { parseDropHint } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * GET /api/drops/live — every drop that can be claimed right now, for the map.
 *
 * Only active, unexpired, public drops: a few dozen rows instead of the whole
 * drop history the map used to download and filter on the phone. Private drops
 * are excluded here (they're reached by link, never shown on the map).
 *
 * Short CDN cache; `?fresh=1` (sent right after a claim or a new drop) skips the
 * instance cache so the change shows immediately.
 */
export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  try {
    const drops = await memo("drops:live", 10_000, () => fetchLiveDrops(), { fresh });
    const body = drops
      .filter((d) => !parseDropHint(d.hint).isPrivate)
      .map(toDropJson);
    return NextResponse.json(
      { drops: body, at: Date.now() },
      { headers: { "Cache-Control": fresh ? "no-store" : "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (e) {
    console.error("[drops/live]", e);
    return NextResponse.json({ error: "Couldn't load drops" }, { status: 502 });
  }
}
