import { parseAbi } from "viem";
import { publicClient } from "@/lib/publicClient";

const IDENTITY = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const abi = parseAbi(["function getWhitelistedRoot(address) view returns (address)"]);

/**
 * Resolve each address to its GoodDollar identity root — so all of a verified
 * human's wallets (root + connected) collapse to one identity for stats and
 * leaderboards. Unverified wallets map to themselves. Batched via multicall.
 *
 * Returns a Map(lowercased address → root-or-self). Never throws — on RPC
 * failure it maps every address to itself (no dedup, but nothing breaks).
 */
// Roots change only on connect/disconnect, so cache per address. Repeated callers
// (every hunter-profile render, the badges API, leaderboards) then only multicall
// the handful of NEW addresses instead of re-resolving every participant each
// time — a big cut to on-chain reads and Active CPU. TTL keeps it eventually fresh.
const ROOT_TTL_MS = 5 * 60 * 1000;
const ROOT_CACHE_MAX = 20_000;
const rootCache = new Map<string, { root: string; at: number }>();

interface RedisLite {
  mget: (...k: string[]) => Promise<(string | null)[]>;
  set: (k: string, v: string, o: { ex: number }) => Promise<unknown>;
}
interface KeysLite { identityRoot: (a: string) => string }

export async function resolveRoots(addresses: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const map = new Map<string, string>();
  if (uniq.length === 0) return map;

  const now = Date.now();
  const need: string[] = [];
  for (const a of uniq) {
    const hit = rootCache.get(a);
    if (hit && now - hit.at < ROOT_TTL_MS) map.set(a, hit.root);
    else need.push(a);
  }
  if (need.length === 0) return map;

  // On the server, share the same cross-instance Redis cache that resolveIdentityRoot
  // writes (key gd:idroot:<addr>). A dynamic import keeps @upstash/redis out of the
  // client bundle (roots.ts is also imported by client pages).
  let redis: RedisLite | null = null;
  let rkeys: KeysLite | null = null;
  if (typeof window === "undefined") {
    try {
      const m = await import("@/lib/redis");
      redis = m.getRedis() as unknown as RedisLite | null;
      rkeys = m.keys as unknown as KeysLite;
    } catch { /* no redis — fall back to chain */ }
  }

  let toChain = need;
  if (redis && rkeys) {
    try {
      const cached = (await redis.mget(...need.map((a) => rkeys!.identityRoot(a)))) as (string | null)[];
      const miss: string[] = [];
      need.forEach((a, i) => {
        const v = cached[i];
        if (typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v)) { map.set(a, v); rootCache.set(a, { root: v, at: now }); }
        else miss.push(a);
      });
      toChain = miss;
    } catch { /* keep full `need` */ }
  }
  if (toChain.length === 0) return map;

  try {
    const results = await publicClient.multicall({
      contracts: toChain.map((a) => ({
        address: IDENTITY, abi, functionName: "getWhitelistedRoot", args: [a as `0x${string}`],
      })),
      allowFailure: true,
    });
    if (rootCache.size > ROOT_CACHE_MAX) rootCache.clear();
    const writes: Promise<unknown>[] = [];
    toChain.forEach((a, i) => {
      const r = results[i];
      const root = r.status === "success" ? (r.result as string).toLowerCase() : ZERO;
      const val = root && root !== ZERO ? root : a;
      map.set(a, val);
      rootCache.set(a, { root: val, at: now });
      // Real root = permanent (24h); self-mapping can still change → short (10m).
      if (redis && rkeys) writes.push(redis.set(rkeys.identityRoot(a), val, { ex: val === a ? 600 : 86_400 }));
    });
    if (writes.length) await Promise.allSettled(writes);
  } catch {
    // Don't cache failures — map to self so nothing breaks, retry next call.
    toChain.forEach((a) => map.set(a, a));
  }
  return map;
}
