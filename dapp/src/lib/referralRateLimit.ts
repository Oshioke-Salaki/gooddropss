import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";

/**
 * Fixed-window per-IP limit for the public referral endpoints. Generous on
 * purpose: mobile carriers put many people behind one IP. Fails OPEN if Redis
 * hiccups, since every write behind it is idempotent and signature-checked.
 */
export async function overLimit(redis: Redis, bucket: string, ip: string, max: number, windowS: number): Promise<boolean> {
  try {
    const k = keys.refRateLimit(bucket, ip);
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowS);
    return n > max;
  } catch {
    return false;
  }
}
