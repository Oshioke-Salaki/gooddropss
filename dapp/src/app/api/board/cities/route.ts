import { NextResponse } from "next/server";
import { getBoardSnapshot } from "@/lib/boardSnapshot";
import { cityBoard, type CityBoardJson } from "@/lib/cities";
import { weekBounds } from "@/lib/quests";
import { memo } from "@/lib/serverCache";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/board/cities — this week's city-vs-city board (Monday 00:00 WAT
 * onward, the same week as the quests): G$ found, finds, hunters and drops
 * hidden per city. Built from the shared drop mirror and identity roots
 * (lib/boardSnapshot), at most once a minute, and served from the CDN.
 */
export async function GET() {
  try {
    const body = await memo<CityBoardJson>("board:cities", 60_000, async () => {
      const { drops, roots } = await getBoardSnapshot();
      const week = weekBounds(Math.floor(Date.now() / 1000));
      const rootOf = (w: string) => roots.get(w.toLowerCase()) ?? w.toLowerCase();
      const rows = cityBoard(drops, rootOf, week).map((r) => ({ ...r, foundWei: r.foundWei.toString() }));
      return { week: { start: week.start, end: week.end }, rows, at: Date.now() };
    });
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (e) {
    console.error("[board/cities]", e);
    return NextResponse.json({ error: "Couldn't load the city board" }, { status: 502 });
  }
}
