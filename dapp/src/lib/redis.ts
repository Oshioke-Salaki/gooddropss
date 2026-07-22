import { Redis } from "@upstash/redis";

// Returns null if Upstash is not configured — all callers handle this gracefully.
export function getRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({
    url,
    token,
    // Fail fast: the default (5 retries, exponential backoff) makes API routes
    // hang for 20–30s when the network blips. One quick retry, then callers'
    // graceful fallbacks kick in.
    retry: { retries: 1, backoff: () => 300 },
  });
}

// ── Key helpers ───────────────────────────────────────────────────────────────
export const keys = {
  subscription:     (address: string) => `sub:${address.toLowerCase()}`,
  comments:         (dropId: string)  => `comments:${dropId}`,
  campaign:         (id: string)      => `gd:campaign:${id}`,
  campaignsByOwner: (addr: string)    => `gd:campaigns:owner:${addr.toLowerCase()}`,
  campaignClaims:   (id: string)      => `gd:campaign:claims:${id}`,
  streak:           (address: string) => `gd:streak:${address.toLowerCase()}`,
  privateDrop:      (token: string)   => `gd:privdrop:${token}`,
  velocity:         (address: string) => `gd:velocity:${address.toLowerCase()}`,
  // Riddle-locked drops
  riddle:           (dropId: string)  => `gd:riddle:${dropId}`,
  riddleLock:       (dropId: string)  => `gd:riddle:lock:${dropId}`,
  riddleTries:      (dropId: string, address: string) =>
    `gd:riddle:tries:${dropId}:${address.toLowerCase()}`,
  // GoodSpots — merchants that accept G$ at a physical location
  spot:             (id: string)      => `gd:spot:${id}`,
  spotsAll:         ()                => `gd:spots:all`,
  spotsByOwner:     (addr: string)    => `gd:spots:owner:${addr.toLowerCase()}`,
  spotPayments:     (id: string)      => `gd:spot:payments:${id}`,
  // Admin-curated map landmarks
  landmark:         (id: string)      => `gd:landmark:${id}`,
  landmarksIndex:   ()                => `gd:landmarks:index`, // Set of ids (idempotent)
  // Ids a wallet has PENDING review — caps how many suggestions one human can queue
  landmarksPendingByWallet: (addr: string) => `gd:landmarks:pending:${addr.toLowerCase()}`,
};
