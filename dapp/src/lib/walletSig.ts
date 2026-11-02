import type { Redis } from "@upstash/redis";
import { keccak256, toBytes, type Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { keys } from "@/lib/redis";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** How long a signed request stays valid. Short, so a leaked signature is useless soon. */
export const SIG_WINDOW_MS = 10 * 60 * 1000;

/**
 * Check a wallet's signature on a message the server rebuilt itself. Returns an
 * error string, or null when it's good.
 *
 *  • The caller builds `message` from what the request will actually do, so the
 *    signature can't be reused for anything else.
 *  • Good for SIG_WINDOW_MS, and only once: an NX marker outlives the window.
 *  • Verified through the chain client, so smart-contract wallets (ERC-1271 /
 *    ERC-6492) work as well as plain keys.
 */
export async function verifyWalletSig(
  redis: Redis,
  args: { address: unknown; signature: unknown; timestamp: unknown; message: (timestamp: number) => string },
): Promise<string | null> {
  const { address, signature, timestamp } = args;
  if (typeof address !== "string" || !ADDR_RE.test(address)) return "Sign in first.";
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return "This page is out of date. Refresh it and try again.";
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "Missing timestamp.";
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW_MS) return "That signature has expired. Please try again.";

  let ok = false;
  try {
    ok = await publicClient.verifyMessage({
      address: address as Hex,
      message: args.message(timestamp),
      signature: signature as Hex,
    });
  } catch { ok = false; }
  if (!ok) return "The signature doesn't match this wallet.";

  const fresh = await redis.set(keys.sigUsed(keccak256(toBytes(signature)).slice(2, 34)), "1", {
    nx: true, ex: Math.ceil((SIG_WINDOW_MS * 2) / 1000),
  });
  if (fresh === null) return "That request was already submitted.";
  return null;
}
