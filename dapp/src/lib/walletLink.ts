import { parseAbi } from "viem";
import { publicClient } from "@/lib/publicClient";
import { IDENTITY_ADDRESS } from "@/lib/identity";
import { extractErrorText } from "@/lib/claimErrors";

const ZERO = "0x0000000000000000000000000000000000000000";

export const IDENTITY_LINK_ABI = parseAbi([
  "function getWhitelistedRoot(address account) view returns (address)",
  "function connectedAccounts(address account) view returns (address)",
  // The deployed IdentityV4 takes the account only; the caller must be the
  // whitelisted root. Probed on Celo mainnet, Nov 2026 (the 3-arg variant in
  // GoodDollar's newer source is NOT deployed).
  "function connectAccount(address account)",
]);

/**
 * The wallet this one is LINKED to via GoodDollar's connectAccount, or null.
 * Unlike getWhitelistedRoot this survives the root's verification lapsing, which
 * is exactly when it matters (renewal).
 */
export async function readLinkedRoot(address: string): Promise<string | null> {
  const r = (await publicClient.readContract({
    address: IDENTITY_ADDRESS, abi: IDENTITY_LINK_ABI,
    functionName: "connectedAccounts", args: [address as `0x${string}`],
  })) as string;
  return r && r.toLowerCase() !== ZERO ? r.toLowerCase() : null;
}

/** getWhitelistedRoot, lowercased; null when not verified (directly or via a link). */
export async function readRoot(address: string): Promise<string | null> {
  const r = (await publicClient.readContract({
    address: IDENTITY_ADDRESS, abi: IDENTITY_LINK_ABI,
    functionName: "getWhitelistedRoot", args: [address as `0x${string}`],
  })) as string;
  return r && r.toLowerCase() !== ZERO ? r.toLowerCase() : null;
}

// ── What the switch-to-email page says when an on-chain step fails ──────────
export function isUserCancel(e: unknown): boolean {
  const c = (e as { code?: string | number } | null)?.code;
  if (c === 4001 || c === "ACTION_REJECTED") return true;
  return /user rejected|user denied|rejected the request|denied transaction|action_rejected|cancell?ed/i.test(extractErrorText(e));
}

// Plain words for what went wrong. Never match on bare "gas": a revert surfaces
// as an EstimateGas error whose NAME contains "gas", which would wrongly tell a
// funded wallet it needs CELO.
export function switchErrorMessage(e: unknown): string {
  if (isUserCancel(e)) return "";
  const m = extractErrorText(e).toLowerCase();
  if (/insufficient funds/.test(m)) return "Your wallet needs a little CELO to cover the small network cost. Add some, then tap Try again.";
  if (/already connected/.test(m)) return "Your email account is already linked to a GoodDollar identity.";
  if (/invalid account/.test(m)) return "Your email account can't be linked because it's already verified by itself.";
  if (/not whitelisted/.test(m)) return "Your wallet's verification isn't active right now. Renew it above, then try again.";
  if (/chain|network/.test(m) && /mismatch|wrong|unsupported/.test(m)) return "Your wallet is on the wrong network. Switch it to Celo, then try again.";
  if (/timeout|timed out|fetch|failed to fetch|network error/.test(m)) return "We couldn't reach the network. Check your connection and try again.";
  return "That didn't go through. Please try again.";
}


/** Magic's email-code dialog closed or the code was abandoned: not an error to show. */
export function isEmailCancel(e: unknown): boolean {
  const c = (e as { code?: string | number } | null)?.code;
  return c === -32603 || c === "MAGIC_LINK_FAILED_VERIFICATION" || isUserCancel(e);
}
