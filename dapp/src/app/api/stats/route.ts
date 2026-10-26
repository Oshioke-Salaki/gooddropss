import { NextResponse } from "next/server";
import { getPublicStats } from "@/app/stats/data";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/stats — the public stats page's numbers (refreshes it every minute). */
export async function GET() {
  try {
    return NextResponse.json(await getPublicStats(), {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch (e) {
    console.error("[stats]", e);
    return NextResponse.json({ error: "Couldn't load stats" }, { status: 502 });
  }
}
