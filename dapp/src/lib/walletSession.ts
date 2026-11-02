import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";

// Server-only. A wallet session proves "this browser signed for wallet X"
// without a signature on every page view. It only unlocks READS of a wallet's
// own private records (pending shops, unapproved events, review notes). Every
// write still needs its own signature.
//
// The cookie holds a random token; Redis stores only its hash, so a leaked
// Redis dump can't be replayed as a cookie. No server secret is needed.

export const SESSION_COOKIE = "gd_wsess";
const TTL_S = 30 * 86_400;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;

const hashToken = (t: string) => createHash("sha256").update(`gd-wsess:${t}`).digest("hex");

/** The wallet this browser has a session for, or null. */
export async function sessionAddress(redis: Redis): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !TOKEN_RE.test(token)) return null;
  try {
    const addr = await redis.get<string>(keys.walletSession(hashToken(token)));
    return typeof addr === "string" && ADDR_RE.test(addr) ? addr : null;
  } catch { return null; }
}

/**
 * Start (or replace) this browser's session for `address`. Call only after the
 * wallet has proven itself with a fresh, verified signature.
 */
export async function startSession(redis: Redis, address: string): Promise<void> {
  const jar = await cookies();
  const old = jar.get(SESSION_COOKIE)?.value;
  if (old && TOKEN_RE.test(old)) await redis.del(keys.walletSession(hashToken(old))).catch(() => {});

  const token = randomBytes(32).toString("hex");
  await redis.set(keys.walletSession(hashToken(token)), address.toLowerCase(), { ex: TTL_S });
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_S,
  });
}

/** Best effort: a failed session write must never fail the action that earned it. */
export async function startSessionQuietly(redis: Redis, address: string): Promise<void> {
  try { await startSession(redis, address); } catch (e) { console.error("[walletSession]", e); }
}

export async function endSession(redis: Redis): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && TOKEN_RE.test(token)) await redis.del(keys.walletSession(hashToken(token))).catch(() => {});
  jar.delete(SESSION_COOKIE);
}
