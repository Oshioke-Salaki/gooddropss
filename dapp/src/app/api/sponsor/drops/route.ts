import { NextRequest, NextResponse } from "next/server";
import { fetchAllDrops } from "@/lib/subgraph";
import { toDropJson } from "@/lib/dropJson";
import { parseDropHint } from "@/lib/utils";

export const runtime = "nodejs";

const CAMPAIGN_ID_RE = /^[a-z0-9-]{1,40}$/i;
const MAX_CAMPAIGNS = 50;

/**
 * GET /api/sponsor/drops?campaigns=id1,id2 — every drop tagged for these
 * campaigns, for the sponsor dashboard. Public on-chain data.
 *
 * The dashboard used to download the whole drop history in the browser to pick
 * these out; now the server filters its drop mirror and sends only the matches.
 */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("campaigns") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_CAMPAIGNS || !ids.every((id) => CAMPAIGN_ID_RE.test(id))) {
    return NextResponse.json({ error: "campaigns: 1 to 50 campaign ids" }, { status: 400 });
  }
  const wanted = new Set(ids);
  try {
    const drops = (await fetchAllDrops()).filter((d) => {
      const c = parseDropHint(d.hint).campaignId;
      return c !== null && wanted.has(c);
    });
    return NextResponse.json(
      { drops: drops.map(toDropJson) },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch (e) {
    console.error("[sponsor/drops]", e);
    return NextResponse.json({ error: "Couldn't load drops" }, { status: 502 });
  }
}
