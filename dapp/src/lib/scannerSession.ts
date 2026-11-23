import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { SCANNER_TTL_S } from "@/lib/taskShared";

// Server-only. A scanner session lets one phone approve a shop owner's reward
// codes for SCANNER_TTL_S after ONE wallet confirmation, instead of a wallet
// prompt for every customer at the counter.
//
// Deliberately separate from the 30-day wallet session (lib/walletSession),
// which only unlocks reads: approving releases escrowed G$, so this one is
//  • short-lived (12 h),
//  • only accepted by /api/task/approve,
//  • SameSite=Strict, so no other site can make the browser use it,
//  • httpOnly, and stored in Redis only as a hash of the token.
// Every approval still re-checks that this wallet owns the reward's shop and
// that the shop is live, so a session can never approve another shop's codes.

const COOKIE = "gd_scan";
const TOKEN_RE = /^[0-9a-f]{64}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;

const hashToken = (t: string) => createHash("sha256").update(`gd-scan:${t}`).digest("hex");

/** The shop owner this browser's scanner is unlocked for, or null. */
export async function scannerAddress(redis: Redis): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !TOKEN_RE.test(token)) return null;
  try {
    const addr = await redis.get<string>(keys.scannerSession(hashToken(token)));
    return typeof addr === "string" && ADDR_RE.test(addr) ? addr : null;
  } catch { return null; }
}

/** Unlock (or re-unlock) this browser's scanner. Call only after a fresh, verified signature. */
export async function startScannerSession(redis: Redis, address: string): Promise<void> {
  const jar = await cookies();
  const old = jar.get(COOKIE)?.value;
  if (old && TOKEN_RE.test(old)) await redis.del(keys.scannerSession(hashToken(old))).catch(() => {});

  const token = randomBytes(32).toString("hex");
  await redis.set(keys.scannerSession(hashToken(token)), address.toLowerCase(), { ex: SCANNER_TTL_S });
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
    maxAge: SCANNER_TTL_S,
  });
}

/** Lock the scanner (sign-out, or the owner locks it themselves). */
export async function endScannerSession(redis: Redis): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token && TOKEN_RE.test(token)) await redis.del(keys.scannerSession(hashToken(token))).catch(() => {});
  jar.delete({ name: COOKIE, path: "/api" });
}
