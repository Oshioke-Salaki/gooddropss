import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";
import { parseDropHint } from "@/lib/utils";
import { cleanTask, isValidTask, type TaskDropRecord } from "@/lib/taskLock";
import { taskCreateMessage } from "@/lib/taskCreateMsg";
import { isSpotActive } from "@/lib/spotStatus";
import { getSpot } from "@/lib/spotStore";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

// POST /api/task/create  Body: { dropId, spotId, task, ownerAddress, signature }
// Called right after a merchant creates a [T:spotId] reward drop on-chain: stores
// the human-readable task text. Owner-signed AND cross-checked against the chain,
// so nobody can attach a task record to a drop they don't own.
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let dropId: string, spotId: string, task: string, ownerAddress: string, signature: string;
  try {
    const b = await req.json();
    dropId = String(b.dropId ?? "");
    spotId = String(b.spotId ?? "");
    task = cleanTask(String(b.task ?? ""));
    ownerAddress = String(b.ownerAddress ?? "").toLowerCase();
    signature = String(b.signature ?? "");
  } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!/^\d+$/.test(dropId)) return NextResponse.json({ error: "Invalid drop" }, { status: 400 });
  if (!ADDR_RE.test(ownerAddress)) return NextResponse.json({ error: "Invalid owner" }, { status: 400 });
  if (!isValidTask(task)) return NextResponse.json({ error: "Task must be 3–80 characters" }, { status: 400 });

  // 1. Owner signature.
  try {
    const ok = await publicClient.verifyMessage({ address: ownerAddress as Hex, message: taskCreateMessage(dropId, spotId), signature: signature as Hex });
    if (!ok) return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 });
  } catch { return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 }); }

  // 2. Caller must own the spot.
  const spot = await getSpot(redis, spotId);
  if (!spot) return NextResponse.json({ error: "Spot not found" }, { status: 404 });
  const owns = spot.ownerAddress?.toLowerCase() === ownerAddress;
  if (!owns) return NextResponse.json({ error: "You don't own this spot" }, { status: 403 });
  if (!isSpotActive(spot)) return NextResponse.json({ error: "This business isn't active yet." }, { status: 403 });

  // 3. The drop must actually be a [T:spotId] task drop on-chain (defense in depth).
  // The client only calls us AFTER the mint tx is confirmed, so if the drop reads
  // back empty it's read-after-write lag on a load-balanced RPC node, not a missing
  // drop — retry for a few seconds before giving up, or we'd reject a real drop
  // ("Drop not found") and leave it funded-but-unclaimable.
  let drop: { dropper: string; hint: string } | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      drop = await publicClient.readContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(dropId)] });
      if (drop && drop.dropper !== ZERO) break;
    } catch { /* transient RPC error — retry */ }
    drop = undefined;
    if (attempt < 5) await new Promise((r) => setTimeout(r, 1200));
  }
  if (!drop || drop.dropper === ZERO) return NextResponse.json({ error: "Drop not found" }, { status: 404 });
  if (parseDropHint(drop.hint).taskMerchantId !== spotId) {
    return NextResponse.json({ error: "Drop is not tagged for this spot" }, { status: 409 });
  }
  if (drop.dropper.toLowerCase() !== ownerAddress) {
    return NextResponse.json({ error: "Only the wallet that funded this reward can set its task." }, { status: 403 });
  }

  // Written once: replaying the signature can't rewrite the task or list the drop twice.
  const rec: TaskDropRecord = { spotId, task, createdAt: Math.floor(Date.now() / 1000) };
  const fresh = await redis.set(keys.taskDrop(dropId), rec, { nx: true });
  if (fresh === null) return NextResponse.json({ ok: true, existing: true });
  await redis.lpush(keys.taskDropsBySpot(spotId), dropId);   // index for the merchant's reward list
  return NextResponse.json({ ok: true });
}
