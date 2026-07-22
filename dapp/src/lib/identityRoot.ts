import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

// GoodDollar Identity contract (Celo mainnet)
const IDENTITY_ADDRESS = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const ZERO = "0x0000000000000000000000000000000000000000";

const IDENTITY_ABI = [
  {
    name: "getWhitelistedRoot",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "root", type: "address" }],
  },
] as const;

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

// Roots change rarely (only on connect/disconnect). Cache within a warm serverless
// instance to avoid an RPC round-trip on every stats read/write.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX    = 5_000; // bound memory on long-lived instances
const cache = new Map<string, { root: string; at: number }>();
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Resolve any wallet address to its GoodDollar identity root — the single key
 * under which all of a verified human's wallets (root + connected) should share
 * stats, streaks, and leaderboard standing.
 *
 * - Verified root wallet   → returns itself
 * - Connected wallet       → returns the root it's linked to
 * - Unverified wallet      → returns itself (stays unique; nothing to merge)
 *
 * Never throws — on RPC failure it falls back to the input address so stats
 * still work, just un-merged, until the next successful read.
 */
/**
 * True if the wallet is a whitelisted GoodDollar human (root or a linked account).
 * Used to gate crowdsourced landmark suggestions to real, unique people — spam
 * resistance that piggybacks on the Sybil resistance. Never throws (fails closed
 * to `false` on a bad address; open to `false` on RPC error so it can't wrongly
 * grant access).
 */
export async function isVerifiedHuman(address: string): Promise<boolean> {
  if (typeof address !== "string" || !ADDR_RE.test(address)) return false;
  try {
    const root = (await client.readContract({
      address: IDENTITY_ADDRESS,
      abi: IDENTITY_ABI,
      functionName: "getWhitelistedRoot",
      args: [address.toLowerCase() as `0x${string}`],
    })) as string;
    return !!root && ADDR_RE.test(root) && root.toLowerCase() !== ZERO;
  } catch {
    return false;
  }
}

export async function resolveIdentityRoot(address: string): Promise<string> {
  // Guard: a malformed address can't be resolved — return it untouched so the
  // caller (which validates its own inputs) still gets a stable, safe key.
  if (typeof address !== "string" || !ADDR_RE.test(address)) {
    return typeof address === "string" ? address.toLowerCase() : "";
  }

  const key = address.toLowerCase();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.root;

  try {
    const root = (await client.readContract({
      address: IDENTITY_ADDRESS,
      abi: IDENTITY_ABI,
      functionName: "getWhitelistedRoot",
      args: [key as `0x${string}`],
    })) as string;

    const resolved =
      root && ADDR_RE.test(root) && root.toLowerCase() !== ZERO ? root.toLowerCase() : key;

    // Evict the oldest entry if the cache is full (simple FIFO bound).
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { root: resolved, at: Date.now() });
    return resolved;
  } catch {
    return key; // RPC down — degrade to the raw address, don't block the caller
  }
}
