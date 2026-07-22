import { Redis } from "@upstash/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";

// Server-only username lookup, so pages that render on the server (hunter
// profiles, OG images) can title themselves with @username. Identity-scoped:
// profiles are keyed by the GoodDollar root (see /api/profile), so we resolve the
// wallet to its root first — a name set on any linked wallet resolves from all.
const redis = Redis.fromEnv({ retry: { retries: 1, backoff: () => 300 } });

export async function getUsername(address: string): Promise<string | null> {
  try {
    const addr = address.toLowerCase();
    const root = await resolveIdentityRoot(addr);
    let p = await redis.get<{ username?: string }>(`gd:profile:${root}`);
    // Legacy fallback for a name set on a linked wallet before identity-scoping.
    if (!p && root !== addr) {
      p = await redis.get<{ username?: string }>(`gd:profile:${addr}`);
    }
    return p?.username ?? null;
  } catch {
    // Redis unreachable — profiles are cosmetic; degrade to no username.
    return null;
  }
}
