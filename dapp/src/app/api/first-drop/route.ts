import { NextRequest, NextResponse, after } from "next/server";
import { getRedis } from "@/lib/redis";
import { REF_ADDR_RE } from "@/lib/referral";
import { firstDropState, type FirstDropView } from "@/lib/firstDrop";
import { firstDropDeps, tryFirstDropPayout } from "@/lib/firstDropServer";
import { clientIp } from "@/lib/eventAuth";
import { overLimit } from "@/lib/referralRateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };

async function handle(req: NextRequest, address: unknown, dropId: unknown, bucket: string, max: number) {
  if (typeof address !== "string" || !REF_ADDR_RE.test(address))
    return NextResponse.json({ error: "valid address required" }, { status: 400 });
  if (dropId !== undefined && (typeof dropId !== "string" || !/^\d{1,30}$/.test(dropId)))
    return NextResponse.json({ error: "bad dropId" }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  if (await overLimit(redis, bucket, clientIp(req.headers), max, 600))
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });

  let state: FirstDropView;
  try {
    state = await firstDropState(redis, address.toLowerCase(), firstDropDeps(), dropId as string | undefined);
  } catch {
    // Chain or indexer unreachable: say nothing rather than something wrong.
    return NextResponse.json({ error: "Couldn't check right now." }, { status: 503, headers: NO_STORE });
  }
  // A bonus waiting to go out: send it after the response, not before.
  if (state.status === "owed") after(tryFirstDropPayout);
  return NextResponse.json(state, { headers: NO_STORE });
}

// GET /api/first-drop?address=0x…  → FirstDropView
// Where this wallet stands on the 200 G$ first-drop bonus. Also registers the
// bonus if their first drop is already out (self-heal for a missed POST).
export async function GET(req: NextRequest) {
  return handle(req, req.nextUrl.searchParams.get("address"), undefined, "fd-get", 240);
}

// POST /api/first-drop  { address, dropId? }  → FirstDropView
// Called right after a drop lands. `dropId` lets a brand-new drop count before
// the indexer catches up; it's checked on-chain against the address. No
// signature needed: the bonus only ever goes to the wallet that made the drop.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { address?: unknown; dropId?: unknown } | null;
  return handle(req, body?.address, body?.dropId, "fd-post", 120);
}
