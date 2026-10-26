import type { Redis } from "@upstash/redis";
import { keccak256, toBytes, type Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { keys } from "@/lib/redis";
import { LIMITS, draftDigest, eventMessage, type EventAction, type EventDraft } from "@/lib/events";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Check an organizer's signature on an event action. Returns an error string,
 * or null when it's good.
 *
 *  • Bound to action + event + exact content + time (see eventMessage), so it
 *    can't be reused for something else.
 *  • Good for 10 minutes, and only once (an NX marker outlives the window).
 *  • Verified through the chain client, so smart-contract wallets (ERC-1271)
 *    work as well as plain keys.
 */
export async function verifyEventSignature(
  redis: Redis,
  args: { address: unknown; signature: unknown; timestamp: unknown; action: EventAction; eventId: string; draft: EventDraft | null },
): Promise<string | null> {
  const { address, signature, timestamp } = args;
  if (typeof address !== "string" || !ADDR_RE.test(address)) return "Sign in first.";
  if (typeof signature !== "string" || !signature.startsWith("0x")) return "Missing signature.";
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "Missing timestamp.";
  if (Math.abs(Date.now() - timestamp) > LIMITS.sigWindowMs) return "That signature has expired — please try again.";

  let ok = false;
  try {
    ok = await publicClient.verifyMessage({
      address: address as Hex,
      message: eventMessage(args.action, args.eventId, timestamp, draftDigest(args.draft)),
      signature: signature as Hex,
    });
  } catch { ok = false; }
  if (!ok) return "The signature doesn't match this wallet.";

  const used = await redis.set(keys.eventSigUsed(keccak256(toBytes(signature)).slice(2, 34)), "1", {
    nx: true, ex: Math.ceil((LIMITS.sigWindowMs * 2) / 1000),
  });
  if (used === null) return "That request was already submitted.";
  return null;
}

export function clientIp(h: Headers): string {
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "local";
}
