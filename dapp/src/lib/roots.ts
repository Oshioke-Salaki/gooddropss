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
export async function resolveRoots(addresses: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const map = new Map<string, string>();
  if (uniq.length === 0) return map;

  try {
    const results = await publicClient.multicall({
      contracts: uniq.map((a) => ({
        address: IDENTITY, abi, functionName: "getWhitelistedRoot", args: [a as `0x${string}`],
      })),
      allowFailure: true,
    });
    uniq.forEach((a, i) => {
      const r = results[i];
      const root = r.status === "success" ? (r.result as string).toLowerCase() : ZERO;
      map.set(a, root && root !== ZERO ? root : a);
    });
  } catch {
    uniq.forEach((a) => map.set(a, a));
  }
  return map;
}
