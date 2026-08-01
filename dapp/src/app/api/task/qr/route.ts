import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";
import { isVerifiedHuman, resolveIdentityRoot } from "@/lib/identityRoot";
import { parseDropHint, haversineDistance, gpsToDeg } from "@/lib/utils";
import { newNonce, QR_TTL_S, QR_COOLDOWN_S, type TaskQrRecord, type TaskDropRecord } from "@/lib/taskLock";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

// POST /api/task/qr  Body: { dropId, address, lat, lng }
// The hunter, standing at a merchant task drop, mints a SINGLE-USE QR nonce for
// the merchant to scan. Proves they're present + verified; the merchant approval
// (separate call) is what actually unlocks the claim.
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
    return NextResponse.json({ error: "This drop is no longer claimable." }, { status: 409 });
  }

  const spotId = parseDropHint(drop.hint).taskMerchantId;
  if (!spotId) return NextResponse.json({ error: "This isn't a task drop." }, { status: 400 });

  // Must be at the drop (task drops are never private, so coords are on-chain).
  const distM = haversineDistance(lat, lng, gpsToDeg(Number(drop.lat)), gpsToDeg(Number(drop.lng)));
  if (distM > CLAIM_RADIUS_M) {
    return NextResponse.json({ error: `Get closer — you're ~${Math.round(distM)}m away.` }, { status: 403 });
  }

  const root = (await resolveIdentityRoot(address)).toLowerCase();

  // Anti-spam: one nonce mint per hunter per cooldown.
  const cd = await redis.set(keys.taskQrCooldown(root), "1", { nx: true, ex: QR_COOLDOWN_S });
  if (cd === null) return NextResponse.json({ error: "One moment — try again in a few seconds." }, { status: 429 });

  const nonce = newNonce();
  const record: TaskQrRecord = { dropId, root, spotId };
  await redis.set(keys.taskQr(nonce), record, { ex: QR_TTL_S });

  const taskRec = await redis.get<TaskDropRecord>(keys.taskDrop(dropId)).catch(() => null);
  return NextResponse.json({
    nonce,
    expiresInS: QR_TTL_S,
    spotId,
    task: taskRec?.task ?? null,
  });
}
