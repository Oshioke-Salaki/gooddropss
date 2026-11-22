import { NextRequest, NextResponse } from "next/server";
import { fetchDropByDropId } from "@/lib/subgraph";
import { readDropFromChain } from "@/lib/chainDrops";
import { toDropJson } from "@/lib/dropJson";

export const runtime = "nodejs";

const ID_RE = /^\d{1,30}$/;

/**
 * GET /api/drops/:id — one drop, for the drop page and its printable sticker.
 *
 * The contract is the truth for its state (found? reclaimed? extended?), so it's
 * always read; the indexer adds when it was created. Either one alone is enough:
 * a brand-new drop the indexer hasn't seen yet still shows, and so does every
 * drop while the indexer is down. 404 only when the contract says it doesn't exist.
 *
 * `?fresh=1` (right after an action on the page) skips the short CDN cache.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";

  const indexed = await fetchDropByDropId(id); // never throws
  let onChain: Awaited<ReturnType<typeof readDropFromChain>> | undefined;
  try {
    onChain = await readDropFromChain(BigInt(id), indexed ?? undefined);
  } catch (e) {
    console.warn("[drops/:id] contract read failed", (e as Error).message);
  }

  // Contract answered: its state wins. A drop only the contract knows has no
  // creation time yet (0), exactly as the page has always shown it.
  const drop = onChain !== undefined
    ? onChain && { ...onChain, createdAt: indexed?.createdAt ?? 0 }
    : indexed;

  if (drop === undefined || (drop === null && onChain === undefined)) {
    return NextResponse.json({ error: "Couldn't load this drop" }, { status: 502 });
  }
  if (!drop) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=10" } });
  return NextResponse.json(
    { drop: toDropJson(drop) },
    { headers: { "Cache-Control": fresh ? "no-store" : "public, s-maxage=5, stale-while-revalidate=30" } },
  );
}
