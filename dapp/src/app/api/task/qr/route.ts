import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";
import { isVerifiedHuman, resolveIdentityRoot } from "@/lib/identityRoot";
import { parseDropHint, haversineDistance, gpsToDeg } from "@/lib/utils";
import { issueTaskCode } from "@/lib/taskCode";
import type { TaskDropRecord } from "@/lib/taskLock";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";
const NO_STORE = { "Cache-Control": "private, no-store" };

// POST /api/task/qr  Body: { dropId, address, lat, lng }
// The hunter, standing at a merchant task drop, gets the SINGLE-USE code the
// merchant scans. Proves they're present + verified; the merchant approval
// (separate call) is what actually unlocks the claim.
//
// Responses:
//   { approved: true }                         the shop already approved them: go claim
//   { nonce, code, expiresInS, task, ... }     the code to show (the same one while it's fresh)
//   429 { error, retryAfterS }                 asked for a NEW code too soon: retry after that
//   4xx { error, reason? }                     can't get a code (message is customer-facing);
//                                              reason: "gone" | "held" | "far"
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let dropId: string, address: string, lat: number, lng: number;
  try {
    const b = await req.json();
    dropId = String(b.dropId ?? "");
    address = String(b.address ?? "").toLowerCase();
    lat = Number(b.lat); lng = Number(b.lng);
  } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!/^\d+$/.test(dropId)) return NextResponse.json({ error: "Invalid drop" }, { status: 400 });
  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "Location required" }, { status: 400 });

  // Verified human only (same bar as claiming).
  if (!(await isVerifiedHuman(address))) {
    return NextResponse.json({ error: "Verify with GoodDollar first." }, { status: 403 });
  }

  // Fetch the drop and confirm it's a live TASK drop.
  let drop;
  try {
    drop = await publicClient.readContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(dropId)],
    });
  } catch { return NextResponse.json({ error: "Drop not found" }, { status: 404 }); }
  if (!drop || drop.dropper === ZERO) return NextResponse.json({ error: "Drop not found" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  if (Number(drop.status) !== 0 || Number(drop.expiry) <= now) {
    return NextResponse.json({ error: "This reward has already been claimed or has expired.", reason: "gone" }, { status: 409 });
  }

  const spotId = parseDropHint(drop.hint).taskMerchantId;
  if (!spotId) return NextResponse.json({ error: "This isn't a task drop." }, { status: 400 });
  if (drop.dropper.toLowerCase() === address) {
    return NextResponse.json({ error: "This is your own shop's reward, so you can't claim it." }, { status: 403 });
  }

  const root = (await resolveIdentityRoot(address)).toLowerCase();

  // Already approved (they closed the screen while the shop scanned): skip
  // straight to claiming. Checked before distance: indoor GPS can drift, and
  // the claim itself re-checks where they are.
  if (await redis.get(keys.taskApproval(dropId, root))) {
    return NextResponse.json({ approved: true }, { headers: NO_STORE });
  }

  // Must be at the drop (task drops are never private, so coords are on-chain).
  const distM = haversineDistance(lat, lng, gpsToDeg(Number(drop.lat)), gpsToDeg(Number(drop.lng)));
  if (distM > CLAIM_RADIUS_M) {
    return NextResponse.json({ error: `Get a little closer to the shop. You're about ${Math.round(distM)}m away.`, reason: "far" }, { status: 403 });
  }

  // One reward, one customer at a time: if the shop just approved someone else
  // for it, don't let this person do the task for nothing.
  const reservedFor = await redis.get<string>(keys.taskReserved(dropId));
  if (reservedFor && reservedFor !== root) {
    return NextResponse.json({ error: "Another customer is claiming this reward right now. Try again in a few minutes.", reason: "held" }, { status: 409 });
  }

  const issued = await issueTaskCode(redis, { dropId, root, spotId });
  if (!issued.ok) {
    return NextResponse.json(
      { error: "One moment, getting your code…", retryAfterS: issued.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  const taskRec = await redis.get<TaskDropRecord>(keys.taskDrop(dropId)).catch(() => null);
  return NextResponse.json({
    nonce: issued.nonce,
    code: issued.code,
    expiresInS: issued.expiresInS,
    spotId,
    task: taskRec?.task ?? null,
  }, { headers: NO_STORE });
}
