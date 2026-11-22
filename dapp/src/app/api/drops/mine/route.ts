import { NextRequest, NextResponse } from "next/server";
import { fetchDropsForAddress } from "@/lib/subgraph";
import { memo } from "@/lib/serverCache";
import { toDropJson } from "@/lib/dropJson";
import { indexerLag, readDropsFromChain } from "@/lib/chainDrops";
import type { Drop } from "@/types";

/**
 * While the indexer is stalled, a drop it still lists as active may have been
 * found, reclaimed or extended since. Re-read just those from the contract so
 * the owner's buttons (reclaim, reactivate) act on the truth. Best effort.
 */
async function withChainStatus(drops: Drop[]): Promise<Drop[]> {
  const active = drops.filter((d) => d.status === 0);
  if (active.length === 0) return drops;
  try {
    if (!(await indexerLag()).stale) return drops;
    const byId = new Map(drops.map((d) => [d.id.toString(), d]));
    const fresh = await readDropsFromChain(active.slice(0, 300).map((d) => d.id), (id) => byId.get(id));
    for (const d of fresh) byId.set(d.id.toString(), d);
    return drops.map((d) => byId.get(d.id.toString()) ?? d);
  } catch {
    return drops;
  }
}

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
    const drops = await memo(
      `drops:mine:${address}`, 5_000,
      async () => withChainStatus(await fetchDropsForAddress(address, { fresh })),
      { fresh },
    );
    return NextResponse.json(
      { drops: drops.map(toDropJson), at: Date.now() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[drops/mine]", e);
    return NextResponse.json({ error: "Couldn't load drops" }, { status: 502 });
  }
}
