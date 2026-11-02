import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";
import { clientIp } from "@/lib/eventAuth";
import { getSpot } from "@/lib/spotStore";
import { CODE_RE, NONCE_RE, type TaskDropRecord, type TaskQrRecord } from "@/lib/taskLock";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/task/peek?code=123456 | ?nonce=<32 hex>
// What a merchant sees after scanning, BEFORE signing: which reward, how much,
// for which shop, and whether it can still be claimed. Returns the one-time
// nonce, which is what the merchant then signs (never the short code). Nothing
// here is secret, and nothing is approved by reading it.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  // Typed codes are short, so cap lookups per network to stop anyone sweeping them.
  const rl = keys.taskPeekRl(clientIp(req.headers));
  const hits = await redis.incr(rl);
  if (hits === 1) await redis.expire(rl, 3600);
  if (hits > 120) return NextResponse.json({ error: "Too many tries. Wait a little and try again." }, { status: 429, headers: NO_STORE });

  const code = (req.nextUrl.searchParams.get("code") ?? "").replace(/\s+/g, "");
  const given = (req.nextUrl.searchParams.get("nonce") ?? "").toLowerCase();
  let nonce: string | null = null;
  if (CODE_RE.test(code)) nonce = await redis.get<string>(keys.taskCode(code));
  else if (NONCE_RE.test(given)) nonce = given;
  else return NextResponse.json({ error: "That code doesn't look right." }, { status: 400, headers: NO_STORE });

  const qr = nonce ? await redis.get<TaskQrRecord>(keys.taskQr(nonce)) : null;
  if (!nonce || !qr) return NextResponse.json({ error: "This code has expired. Ask them to show a fresh one." }, { status: 404, headers: NO_STORE });

  const [spot, rec] = await Promise.all([
    getSpot(redis, qr.spotId),
    redis.get<TaskDropRecord>(keys.taskDrop(qr.dropId)).catch(() => null),
  ]);

  let amountWei = "0";
  let claimable = false;
  try {
    const drop = await publicClient.readContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(qr.dropId)],
    });
    amountWei = drop.amount.toString();
    claimable = Number(drop.status) === 0 && Number(drop.expiry) > Math.floor(Date.now() / 1000);
  } catch { /* shown as not claimable; approve re-checks anyway */ }

  return NextResponse.json({
    nonce,
    task: rec?.task ?? "Reward",
    amountWei,
    claimable,
    spotId: qr.spotId,
    spotName: spot?.name ?? null,
    ownerAddress: spot?.ownerAddress ?? null,
  }, { headers: NO_STORE });
}
