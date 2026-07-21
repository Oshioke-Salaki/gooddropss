import { Redis } from "@upstash/redis";

// Server-only username lookup, so pages that render on the server (hunter
// profiles, OG images) can title themselves with @username. Mirrors the storage
// key used by /api/profile.
const redis = Redis.fromEnv({ retry: { retries: 1, backoff: () => 300 } });

export async function getUsername(address: string): Promise<string | null> {
  try {
    const p = await redis.get<{ username?: string }>(
      `gd:profile:${address.toLowerCase()}`,
    );
    return p?.username ?? null;
  } catch {
    // Redis unreachable — profiles are cosmetic; degrade to no username.
    return null;
  }
}
