import { friendlyClaimError, type ClaimErrorKind } from "@/lib/claimErrors";
import { claimOutcome, StillPendingError, TxFailedError } from "@/lib/txOutcome";

// Shared by every claim surface (map sheet, drop page, hunting mode) so they
// all read a failure the same way, and nobody who actually won a drop is ever
// told they lost it.

export type ClaimFailure =
  | { result: "won" }                       // it went through after all
  | { result: "rejected" }                  // they closed the wallet prompt: say nothing
  | { result: "pending"; message: string }  // sent, ending not seen yet: check, don't resend
  | { result: "failed"; gone: boolean; message: string; kind: ClaimErrorKind };

export async function settleClaimError(e: unknown, dropId: bigint, address: string | undefined): Promise<ClaimFailure> {
  // A write that went out may well have landed: ask the contract first.
  if (e instanceof StillPendingError || e instanceof TxFailedError) {
    const o = await claimOutcome(dropId, address);
    if (o === "mine") return { result: "won" };
    if (e instanceof StillPendingError && (o === "open" || o === "unknown")) {
      return { result: "pending", message: "Your claim is still going through. Give it a moment, then tap Try again to check on it." };
    }
  }

  const fe = friendlyClaimError(e);
  if (fe.kind === "rejected") return { result: "rejected" };

  // Many raw errors (network blips, fees) don't say whether the drop is still
  // there, so look before saying "someone beat you to it".
  let gone = fe.terminal;
  let message = fe.message;
  if (fe.kind !== "event" && (!gone || fe.kind === "claimed")) {
    const o = await claimOutcome(dropId, address);
    if (o === "mine") return { result: "won" };
    if (o === "taken")          { gone = true; message = "Someone beat you to it. This drop has already been found."; }
    else if (o === "reclaimed") { gone = true; message = "The person who hid this took it back. It's no longer here."; }
    else if (o === "expired")   { gone = true; message = "This drop has expired and can't be claimed any more."; }
  }
  return { result: "failed", gone, message, kind: fe.kind };
}

/** Before retrying after an unclear ending: did the first try land, or is the drop gone? */
export async function checkBeforeRetry(dropId: bigint, address: string | undefined): Promise<"won" | "gone" | "go"> {
  const o = await claimOutcome(dropId, address);
  if (o === "mine") return "won";
  if (o === "taken" || o === "reclaimed" || o === "expired") return "gone";
  return "go";
}
