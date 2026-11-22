import { NextRequest, NextResponse } from "next/server";
import { boardToJson, type BoardJson } from "@/lib/board";
import { getBoardSnapshot } from "@/lib/boardSnapshot";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/board — both leaderboards (droppers, hunters) plus the totals.
 *
 * Built once per minute on the server (lib/boardSnapshot, shared with /stats),
 * grouped by GoodDollar identity root, and served from the CDN.
 * `?fresh=1` (the Rankings refresh button) rebuilds it, at most every few seconds.
 */
export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  try {
    const snap = await getBoardSnapshot({ fresh });
    const board: BoardJson = boardToJson(snap.board, snap.at);
    return NextResponse.json(board, {
      headers: { "Cache-Control": fresh ? "no-store" : "public, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch (e) {
    console.error("[board]", e);
    return NextResponse.json({ error: "Couldn't load the board" }, { status: 502 });
  }
}
