import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import {
  newCode, newNonce, QR_COOLDOWN_S, QR_REUSE_MIN_S, QR_TTL_S, type TaskQrRecord,
} from "@/lib/taskLock";

// Server-only. Hands a customer the code a shop scans to approve their reward.
//
// Idempotent per (reward, person): while their code has more than
// QR_REUSE_MIN_S left, asking again returns the SAME code. So reopening the
// sheet, a second tab, a remount or a flaky network never swaps the code out
// from under a cashier who is halfway through typing it. Only when it's close
// to expiring is a new one minted (the old one stays valid until its own TTL).

export type IssuedCode =
  | { ok: true; nonce: string; code: string | null; expiresInS: number; reused: boolean }
  | { ok: false; retryAfterS: number };

export async function issueTaskCode(
  redis: Redis,
  rec: { dropId: string; root: string; spotId: string },
): Promise<IssuedCode> {
  const root = rec.root.toLowerCase();
  const mineKey = keys.taskQrMine(rec.dropId, root);

  const live = await redis.get<string>(mineKey);
  if (live) {
    const [qr, ttl] = await Promise.all([
      redis.get<TaskQrRecord>(keys.taskQr(live)),
      redis.ttl(keys.taskQr(live)),
    ]);
    if (qr && qr.dropId === rec.dropId && qr.root === root && ttl > QR_REUSE_MIN_S) {
      return { ok: true, nonce: live, code: qr.code ?? null, expiresInS: ttl, reused: true };
    }
  }

  // Anti-spam: one NEW code per person per cooldown (re-asks above are free).
  const cd = await redis.set(keys.taskQrCooldown(root), "1", { nx: true, ex: QR_COOLDOWN_S });
  if (cd === null) {
    const left = await redis.ttl(keys.taskQrCooldown(root));
    return { ok: false, retryAfterS: left > 0 ? left : QR_COOLDOWN_S };
  }

  const nonce = newNonce();
  // A six-digit code the shop can type when it can't scan. Retried on the rare
  // collision with another live code.
  let code: string | undefined;
  for (let i = 0; i < 5 && !code; i++) {
    const c = newCode();
    if ((await redis.set(keys.taskCode(c), nonce, { nx: true, ex: QR_TTL_S })) !== null) code = c;
  }
  const record: TaskQrRecord = { dropId: rec.dropId, root, spotId: rec.spotId, ...(code ? { code } : {}) };
  await redis.set(keys.taskQr(nonce), record, { ex: QR_TTL_S });
  await redis.set(mineKey, nonce, { ex: QR_TTL_S });
  return { ok: true, nonce, code: code ?? null, expiresInS: QR_TTL_S, reused: false };
}
