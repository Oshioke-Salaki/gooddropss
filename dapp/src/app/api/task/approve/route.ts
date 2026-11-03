import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";
import { getSpot } from "@/lib/spotStore";
import {
  approveMessage, APPROVAL_TTL_S, CODE_RE, MERCHANT_DAILY_CAP, NONCE_RE, type TaskQrRecord,
} from "@/lib/taskLock";
import { isSpotActive } from "@/lib/spotStatus";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// POST /api/task/approve  Body: { nonce | code, merchantWallet, signature }
// The MERCHANT scans the hunter's QR (or types its 6-digit code) and approves it.
// Only the wallet that owns the spot bound to the drop can approve. Approval
// writes a short-lived record that /api/claim-proof requires; the code is burned
// (single-use) and the reward is held for this one customer while they claim.
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let token: string, merchantWallet: string, signature: string;
  try {
    const b = await req.json();
    token = String(b.code ?? b.nonce ?? "").replace(/\s+/g, "").toLowerCase();
    merchantWallet = String(b.merchantWallet ?? "").toLowerCase();
    signature = String(b.signature ?? "");
  } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const isCode = CODE_RE.test(token);
  if (!isCode && !NONCE_RE.test(token)) return NextResponse.json({ error: "That code doesn't look right." }, { status: 400 });
  if (!ADDR_RE.test(merchantWallet)) return NextResponse.json({ error: "Invalid merchant wallet" }, { status: 400 });

  // 1. Prove the caller controls the merchant wallet (signed exactly this code).
  //    Through the chain client so smart-contract wallets (ERC-1271/6492) verify too.
  try {
    const ok = await publicClient.verifyMessage({
      address: merchantWallet as Hex,
      message: approveMessage(token),
      signature: signature as Hex,
    });
    if (!ok) return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 });
  } catch { return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 }); }

  // 2. Resolve the code → its drop / hunter / spot.
  const nonce = isCode ? await redis.get<string>(keys.taskCode(token)) : token;
  const qr = nonce ? await redis.get<TaskQrRecord>(keys.taskQr(nonce)) : null;
  if (!nonce || !qr) return NextResponse.json({ error: "This code has expired. Ask them to show a fresh one." }, { status: 404 });

  // 3. The signer must own the spot bound to the drop. Only the owner wallet:
  //    the payout wallet is just an address the owner typed, never proven.
  const spot = await getSpot(redis, qr.spotId);
  if (!spot) return NextResponse.json({ error: "Merchant spot not found." }, { status: 404 });
  if (spot.ownerAddress?.toLowerCase() !== merchantWallet) {
    return NextResponse.json({ error: "This reward belongs to a different shop." }, { status: 403 });
  }
  if (!isSpotActive(spot)) return NextResponse.json({ error: "This business isn't active, so it can't approve rewards." }, { status: 403 });

  // 4. The reward must still be up for grabs, or the customer did the task for nothing.
  try {
    const drop = await publicClient.readContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(qr.dropId)],
    });
    if (Number(drop.status) !== 0 || Number(drop.expiry) <= Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: "This reward has already been claimed or has expired." }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: "Couldn't check the reward right now. Try again." }, { status: 503 });
  }

  // 5. Hold the reward for this customer while they claim (one at a time).
  const held = await redis.set(keys.taskReserved(qr.dropId), qr.root, { nx: true, ex: APPROVAL_TTL_S });
  if (held === null) {
    const holder = await redis.get<string>(keys.taskReserved(qr.dropId));
    if (holder !== qr.root) {
      return NextResponse.json({ error: "You just approved another customer for this reward. Create another reward to serve more people." }, { status: 409 });
    }
  }

  // 6. Per-merchant daily cap (anti-abuse). Reserve before writing; roll back on failure.
  const today = new Date().toISOString().slice(0, 10);
  const capKey = keys.taskApprovalsDaily(qr.spotId, today);
  const n = await redis.incr(capKey);
  if (n === 1) await redis.expire(capKey, 48 * 3600);
  if (n > MERCHANT_DAILY_CAP) {
    await redis.decr(capKey).catch(() => {});
    if (held !== null) await redis.del(keys.taskReserved(qr.dropId)).catch(() => {});
    return NextResponse.json({ error: "Daily approval limit reached. Try again tomorrow." }, { status: 429 });
  }

  // 7. Burn the code atomically: of two simultaneous scans, exactly one wins.
  const burned = await redis.getdel(keys.taskQr(nonce));
  if (!burned) {
    await redis.decr(capKey).catch(() => {});
    if (held !== null) await redis.del(keys.taskReserved(qr.dropId)).catch(() => {});
    return NextResponse.json({ error: "This code was already used. Ask them to show a fresh one." }, { status: 409 });
  }
  if (qr.code) await redis.del(keys.taskCode(qr.code)).catch(() => {});

  // 8. Approve: unlock the claim, log it.
  await redis.set(keys.taskApproval(qr.dropId, qr.root), { spotId: qr.spotId, at: Math.floor(Date.now() / 1000) }, { ex: APPROVAL_TTL_S });
  redis.lpush(keys.taskApprovalLog(), JSON.stringify({ ts: Math.floor(Date.now() / 1000), dropId: qr.dropId, root: qr.root, spotId: qr.spotId, by: merchantWallet }))
    .then(() => redis.ltrim(keys.taskApprovalLog(), 0, 999)).catch(() => {});

  return NextResponse.json({ ok: true, dropId: qr.dropId });
}
