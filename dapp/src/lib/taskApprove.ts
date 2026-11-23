import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { getSpot } from "@/lib/spotStore";
import { isSpotActive } from "@/lib/spotStatus";
import { APPROVAL_TTL_S, CODE_RE, MERCHANT_DAILY_CAP, NONCE_RE, type TaskQrRecord } from "@/lib/taskLock";

// Server-only. The rules for a shop approving a customer's reward code, apart
// from HOW the shop proved who it is (a per-scan signature or an unlocked
// scanner: see /api/task/approve). `merchant` must already be proven.

export type ApproveResult =
  | { ok: true; dropId: string }
  | { ok: false; status: number; error: string };

/** "481 205", "481205" or a 32-hex nonce → the normalized token, or null. */
export function parseApproveToken(raw: unknown): string | null {
  const t = String(raw ?? "").replace(/\s+/g, "").toLowerCase();
  return CODE_RE.test(t) || NONCE_RE.test(t) ? t : null;
}

export async function approveTaskToken(
  redis: Redis,
  args: {
    token: string;
    merchant: string;
    /** On-chain status/expiry of the reward. Throws when the chain can't be read. */
    readDrop: (dropId: string) => Promise<{ status: number; expiry: number }>;
    now?: number;
  },
): Promise<ApproveResult> {
  const merchant = args.merchant.toLowerCase();
  const now = args.now ?? Math.floor(Date.now() / 1000);

  // 1. Resolve the code → its reward / customer / shop.
  const nonce = CODE_RE.test(args.token) ? await redis.get<string>(keys.taskCode(args.token)) : args.token;
  const qr = nonce ? await redis.get<TaskQrRecord>(keys.taskQr(nonce)) : null;
  if (!nonce || !qr) return { ok: false, status: 404, error: "This code has expired. Ask them to show a fresh one." };

  // 2. Only the wallet that owns the shop. Never the payout wallet: that's just
  //    an address the owner typed, never proven.
  const spot = await getSpot(redis, qr.spotId);
  if (!spot) return { ok: false, status: 404, error: "Merchant spot not found." };
  if (spot.ownerAddress?.toLowerCase() !== merchant) {
    return { ok: false, status: 403, error: "This reward belongs to a different shop." };
  }
  if (!isSpotActive(spot)) return { ok: false, status: 403, error: "This business isn't active, so it can't approve rewards." };

  // 3. The reward must still be up for grabs, or the customer did the task for nothing.
  let drop: { status: number; expiry: number };
  try { drop = await args.readDrop(qr.dropId); } catch {
    return { ok: false, status: 503, error: "Couldn't check the reward right now. Try again." };
  }
  if (drop.status !== 0 || drop.expiry <= now) {
    return { ok: false, status: 409, error: "This reward has already been claimed or has expired." };
  }

  // 4. Hold the reward for this customer while they claim (one at a time).
  const held = await redis.set(keys.taskReserved(qr.dropId), qr.root, { nx: true, ex: APPROVAL_TTL_S });
  if (held === null) {
    const holder = await redis.get<string>(keys.taskReserved(qr.dropId));
    if (holder !== qr.root) {
      return { ok: false, status: 409, error: "You just approved another customer for this reward. Create another reward to serve more people." };
    }
  }
  const release = () => (held !== null ? redis.del(keys.taskReserved(qr.dropId)).catch(() => 0) : Promise.resolve(0));

  // 5. Per-shop daily cap (anti-abuse). Reserve before writing; roll back on failure.
  const today = new Date(now * 1000).toISOString().slice(0, 10);
  const capKey = keys.taskApprovalsDaily(qr.spotId, today);
  const n = await redis.incr(capKey);
  if (n === 1) await redis.expire(capKey, 48 * 3600);
  if (n > MERCHANT_DAILY_CAP) {
    await redis.decr(capKey).catch(() => 0);
    await release();
    return { ok: false, status: 429, error: "Daily approval limit reached. Try again tomorrow." };
  }

  // 6. Burn the code atomically: of two simultaneous scans, exactly one wins.
  const burned = await redis.getdel(keys.taskQr(nonce));
  if (!burned) {
    await redis.decr(capKey).catch(() => 0);
    await release();
    return { ok: false, status: 409, error: "This code was already used. Ask them to show a fresh one." };
  }
  await Promise.all([
    qr.code ? redis.del(keys.taskCode(qr.code)).catch(() => 0) : 0,
    redis.del(keys.taskQrMine(qr.dropId, qr.root)).catch(() => 0),
  ]);

  // 7. Approve: unlock the claim, log it.
  await redis.set(keys.taskApproval(qr.dropId, qr.root), { spotId: qr.spotId, at: now }, { ex: APPROVAL_TTL_S });
  redis.lpush(keys.taskApprovalLog(), JSON.stringify({ ts: now, dropId: qr.dropId, root: qr.root, spotId: qr.spotId, by: merchant }))
    .then(() => redis.ltrim(keys.taskApprovalLog(), 0, 999)).catch(() => {});

  return { ok: true, dropId: qr.dropId };
}
