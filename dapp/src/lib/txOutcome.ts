import type { Hex, TransactionReceipt } from "viem";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { DROP_STATUS } from "@/types";

// Once a write has a hash, "it errored" no longer means "nothing happened".
// These helpers keep that distinction, so no screen ever offers a retry that
// would move someone's G$ a second time.

/** The write went out but we couldn't see how it ended (slow network, timeout). */
export class StillPendingError extends Error {
  constructor(public hash: Hex) {
    super("Still going through");
    this.name = "StillPendingError";
  }
}

/** The write was included but did nothing (e.g. someone else got there first). */
export class TxFailedError extends Error {
  constructor(public hash: Hex) {
    super("It didn't go through");
    this.name = "TxFailedError";
  }
}

/**
 * Wait for a sent write to finish. Resolves only on success; throws
 * TxFailedError if it was included but failed, and StillPendingError for any
 * other problem while waiting (the outcome is unknown, never "safe to resend").
 */
export async function confirmTx(hash: Hex, timeoutMs = 90_000): Promise<TransactionReceipt> {
  let receipt: TransactionReceipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
  } catch {
    throw new StillPendingError(hash);
  }
  if (receipt.status !== "success") throw new TxFailedError(hash);
  return receipt;
}

export type ClaimOutcome = "mine" | "taken" | "reclaimed" | "expired" | "open" | "unknown";

/** Where a drop stands for this person: did *they* get it, or is it gone, or still open? */
export async function claimOutcome(dropId: bigint, address: string | undefined): Promise<ClaimOutcome> {
  try {
    const d = (await publicClient.readContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [dropId],
    })) as { status: number; expiry: number | bigint; claimer: string };
    if (d.status === DROP_STATUS.Claimed) {
      return address && d.claimer.toLowerCase() === address.toLowerCase() ? "mine" : "taken";
    }
    if (d.status === DROP_STATUS.Reclaimed) return "reclaimed";
    if (Number(d.expiry) <= Math.floor(Date.now() / 1000)) return "expired";
    return "open";
  } catch {
    return "unknown";
  }
}
