import { NextResponse } from "next/server";
import { fetchRecentActivity } from "@/lib/subgraph";

// GET /api/activity → the latest drops and claims for the live ticker. Served
// from the CDN for 15 s, so every open tab no longer queries the subgraph itself.
export async function GET() {
  const items = await fetchRecentActivity();
  return NextResponse.json(
    { items: items.map((i) => ({ ...i, amount: i.amount.toString() })) },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" } },
  );
}
