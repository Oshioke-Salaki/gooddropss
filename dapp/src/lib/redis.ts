import { Redis } from "@upstash/redis";

// Returns null if Upstash is not configured — all callers handle this gracefully.
export function getRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ── Key helpers ───────────────────────────────────────────────────────────────
export const keys = {
  subscription: (address: string) => `sub:${address.toLowerCase()}`,
  comments:     (dropId: string)   => `comments:${dropId}`,
};
