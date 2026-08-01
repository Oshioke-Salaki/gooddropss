import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { getRedis, keys } from "@/lib/redis";
import type { Spot } from "@/types";
import {
  approveMessage, APPROVAL_TTL_S, MERCHANT_DAILY_CAP, type TaskQrRecord,
} from "@/lib/taskLock";
import { isSpotActive } from "@/lib/spotStatus";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// POST /api/task/approve  Body: { nonce, merchantWallet, signature }
// The MERCHANT scans the hunter's QR and approves it. Only the wallet that owns
// the spot bound to the drop can approve. Approval writes a short-lived record
// that /api/claim-proof requires, then the nonce is burned (single-use).
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let nonce: string, merchantWallet: string, signature: string;
  try {
    const b = await req.json();
    nonce = String(b.nonce ?? "");
    merchantWallet = String(b.merchantWallet ?? "").toLowerCase();
    signature = String(b.signature ?? "");
  } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!/^[0-9a-f]{32}$/.test(nonce)) return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
  if (!ADDR_RE.test(merchantWallet)) return NextResponse.json({ error: "Invalid merchant wallet" }, { status: 400 });

  // 1. Prove the caller controls the merchant wallet (signed the nonce).
  try {
    const ok = await verifyMessage({
      address: merchantWallet as `0x${string}`,
      message: approveMessage(nonce),
      signature: signature as `0x${string}`,
    });
    if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  } catch { return NextResponse.json({ error: "Signature verification failed" }, { status: 401 }); }

  // 2. Resolve the QR → its drop / hunter / spot.
  const qr = await redis.get<TaskQrRecord>(keys.taskQr(nonce));
  if (!qr) return NextResponse.json({ error: "This code has expired — ask them to show a fresh one." }, { status: 404 });

  // 3. The signer must own the spot bound to the drop.
  const spot = await redis.get<Spot>(keys.spot(qr.spotId));
  if (!spot) return NextResponse.json({ error: "Merchant spot not found." }, { status: 404 });
  const owns = spot.ownerAddress?.toLowerCase() === merchantWallet || spot.wallet?.toLowerCase() === merchantWallet;
  if (!owns) return NextResponse.json({ error: "You don't own this reward drop." }, { status: 403 });
  if (!isSpotActive(spot)) return NextResponse.json({ error: "This business isn't active — can't approve." }, { status: 403 });

  // 4. Per-merchant daily cap (anti-abuse). Reserve before writing; roll back on failure.
  const today = new Date().toISOString().slice(0, 10);
  const capKey = keys.taskApprovalsDaily(qr.spotId, today);
  const n = await redis.incr(capKey);
  if (n === 1) await redis.expire(capKey, 48 * 3600);
  if (n > MERCHANT_DAILY_CAP) {
    await redis.decr(capKey).catch(() => {});
    return NextResponse.json({ error: "Daily approval limit reached — try again tomorrow." }, { status: 429 });
  }

  // 5. Approve: unlock the claim, burn the nonce (single-use), log it.
  await redis.set(keys.taskApproval(qr.dropId, qr.root), { spotId: qr.spotId, at: Math.floor(Date.now() / 1000) }, { ex: APPROVAL_TTL_S });
  await redis.del(keys.taskQr(nonce));
  redis.lpush(keys.taskApprovalLog(), JSON.stringify({ ts: Math.floor(Date.now() / 1000), dropId: qr.dropId, root: qr.root, spotId: qr.spotId, by: merchantWallet }))
    .then(() => redis.ltrim(keys.taskApprovalLog(), 0, 999)).catch(() => {});

  return NextResponse.json({ ok: true, dropId: qr.dropId });
}
