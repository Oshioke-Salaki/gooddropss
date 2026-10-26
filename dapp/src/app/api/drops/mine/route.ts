import { NextRequest, NextResponse } from "next/server";
import { fetchDropsForAddress } from "@/lib/subgraph";
import { memo } from "@/lib/serverCache";
import { toDropJson } from "@/lib/dropJson";

export const runtime = "nodejs";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * GET /api/drops/mine?address=0x… — the drops one wallet created or claimed.
 *
 * Public data (it's all on-chain), so no signature needed. Not CDN-cached: the
 * person asking usually just acted (reclaimed, reactivated, claimed) and must see
 * their own change. A 5s instance memo still absorbs double-mounts.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!address || !ADDR_RE.test(address)) {
    return NextResponse.json({ error: "valid address required" }, { status: 400 });
  }
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  try {
    const drops = await memo(`drops:mine:${address}`, 5_000, () => fetchDropsForAddress(address), { fresh });
    return NextResponse.json(
      { drops: drops.map(toDropJson), at: Date.now() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[drops/mine]", e);
    return NextResponse.json({ error: "Couldn't load drops" }, { status: 502 });
  }
}
