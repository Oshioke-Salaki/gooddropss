import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getBoardSnapshot } from "@/lib/boardSnapshot";
import { analyticsToJson, computeAdminAnalytics } from "@/lib/adminAnalytics";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/admin/analytics — the Analytics page's totals, computed on the server
 * from the shared drop mirror and identity roots (lib/boardSnapshot), so the
 * page loads a few hundred bytes instead of every drop ever made.
 */
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { drops, roots, at } = await getBoardSnapshot();
    return NextResponse.json(
      { analytics: analyticsToJson(computeAdminAnalytics(drops, roots)), at },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[admin/analytics]", e);
    return NextResponse.json({ error: "Couldn't load analytics. Try again in a minute." }, { status: 502 });
  }
}
