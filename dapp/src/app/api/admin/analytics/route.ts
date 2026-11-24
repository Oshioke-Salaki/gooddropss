import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getBoardSnapshot } from "@/lib/boardSnapshot";
import { analyticsToJson, computeAdminAnalytics, withIndexerTotals } from "@/lib/adminAnalytics";
import { fetchIndexerSnapshot } from "@/lib/indexerTotals";
import { autoRewardsG } from "@/lib/circulation";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/admin/analytics — the Analytics page's totals, computed on the server
 * so the page loads a few hundred bytes instead of every drop ever made.
 * Counts, G$ amounts and the daily charts come from the indexer's running
 * totals (lib/indexerTotals); per-person numbers from the shared drop mirror and
 * identity roots (lib/boardSnapshot). If the running totals can't be read, the
 * mirror supplies everything, as before. `totals` says which one was used.
 */
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [{ drops, roots, at }, idx, autoG] = await Promise.all([getBoardSnapshot(), fetchIndexerSnapshot(), autoRewardsG()]);
    const now = Date.now();
    const base = computeAdminAnalytics(drops, roots, now);
    const totals = idx ? withIndexerTotals(base, idx, now) : base;
    // Plus what the app has paid out by itself (referral payouts, first-drop bonuses).
    const analytics = { ...totals, circulatedWei: totals.circulatedWei + BigInt(autoG) * 10n ** 18n };
    return NextResponse.json(
      { analytics: analyticsToJson(analytics), at, totals: idx ? "indexer" : "mirror" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[admin/analytics]", e);
    return NextResponse.json({ error: "Couldn't load analytics. Try again in a minute." }, { status: 502 });
  }
}
