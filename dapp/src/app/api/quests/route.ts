import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { weekBounds, evaluateQuests } from "@/lib/quests";
import { fetchWeekActivity } from "@/lib/weekActivity";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/quests?address=0x… — this week's three quests and progress.
// Read-only and cheap (two filtered subgraph queries + two Redis reads).
// Short CDN cache: progress should move soon after a claim, but a profile
// refresh shouldn't hit the subgraph every time.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !ADDR_RE.test(address)) {
    return NextResponse.json({ error: "valid address required" }, { status: 400 });
  }

  const nowS = Math.floor(Date.now() / 1000);
  const week = weekBounds(nowS);

  try {
    const activity = await fetchWeekActivity(getRedis(), address, week, nowS);
    const quests = evaluateQuests(week.index, activity);
    return NextResponse.json(
      {
        weekStart: week.start,
        weekEnd: week.end,
        quests,
        completedCount: quests.filter((q) => q.done).length,
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (e) {
    console.error("[quests]", e);
    return NextResponse.json({ error: "Couldn't load quests" }, { status: 502 });
  }
}
