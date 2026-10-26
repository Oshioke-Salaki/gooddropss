import { NextRequest, NextResponse } from "next/server";
import { fetchAllDrops } from "@/lib/subgraph";
import { resolveRoots } from "@/lib/roots";
import { memo } from "@/lib/serverCache";
import { buildBoard, boardToJson, type BoardJson } from "@/lib/board";

export const runtime = "nodejs";
export const maxDuration = 30;

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * GET /api/board — both leaderboards (droppers, hunters) plus the totals.
 *
 * Built once per minute on the server from the full drop set, grouped by
 * GoodDollar identity root, and served from the CDN. Every phone used to page
 * through the entire drop history and run this same computation itself.
 * `?fresh=1` (the Rankings refresh button) rebuilds it.
 */
export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  try {
    const board: BoardJson = await memo("board", 60_000, async () => {
      const drops = await fetchAllDrops({ fresh });
      const addrs = new Set<string>();
      for (const d of drops) {
        addrs.add(d.dropper.toLowerCase());
        if (d.claimer !== ZERO) addrs.add(d.claimer.toLowerCase());
      }
      const roots = await resolveRoots([...addrs]);
      return boardToJson(buildBoard(drops, roots), Date.now());
    }, { fresh });
    return NextResponse.json(board, {
      headers: { "Cache-Control": fresh ? "no-store" : "public, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch (e) {
    console.error("[board]", e);
    return NextResponse.json({ error: "Couldn't load the board" }, { status: 502 });
  }
}
