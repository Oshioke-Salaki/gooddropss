import { NextRequest, NextResponse } from "next/server";
import { fetchLiveDrops } from "@/lib/subgraph";
import { memo } from "@/lib/serverCache";
import { toDropJson } from "@/lib/dropJson";
import { parseDropHint } from "@/lib/utils";
import { getRedis } from "@/lib/redis";
import { getEvents } from "@/lib/eventStore";
import { eventClaimGate, eventIdOf } from "@/lib/events";
import type { Drop } from "@/types";

/**
 * Event drops loaded before their event starts can't be claimed yet (see
 * /api/claim-proof), so they stay off the map until then — the event page
 * shows them as "waiting" instead. If the events can't be read, hide every
 * event drop rather than show chests nobody can open.
 */
async function withoutLockedEventDrops(drops: Drop[]): Promise<Drop[]> {
  const ids = [...new Set(drops.map((d) => eventIdOf(d.hint)).filter((x): x is string => !!x))];
  if (ids.length === 0) return drops;
  const redis = getRedis();
  if (!redis) return drops.filter((d) => !eventIdOf(d.hint));
  try {
    const events = new Map((await getEvents(redis, ids)).map((e) => [e.id, e]));
    const now = Math.floor(Date.now() / 1000);
    return drops.filter((d) => {
      const id = eventIdOf(d.hint);
      return !id || !eventClaimGate(events.get(id) ?? null, d.dropper, now).locked;
    });
  } catch {
    return drops.filter((d) => !eventIdOf(d.hint));
  }
}

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
    const visible = drops.filter((d) => !parseDropHint(d.hint).isPrivate);
    const body = (await withoutLockedEventDrops(visible)).map(toDropJson);
    return NextResponse.json(
      { drops: body, at: Date.now() },
      { headers: { "Cache-Control": fresh ? "no-store" : "public, s-maxage=10, stale-while-revalidate=30" } },
    );
  } catch (e) {
    console.error("[drops/live]", e);
    return NextResponse.json({ error: "Couldn't load drops" }, { status: 502 });
  }
}
