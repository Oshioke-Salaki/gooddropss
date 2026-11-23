"use client";
import { useCallback, useRef, useState } from "react";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { confirmTx } from "@/lib/txOutcome";
import { checkBeforeRetry, settleClaimError } from "@/lib/claimFlow";
import { ensureGasForClaim } from "@/lib/ensureGas";
import { formatG$, getDropRarity } from "@/lib/utils";
import { fireChestReward } from "@/components/ChestReward";
import { track, claimFailReason, type ClaimSurface } from "@/lib/analytics";
import type { LatLng } from "@/types";

// The whole claim, one place: gas → server proof → claimWithProof → confirm →
// chest. Shared by the drop sheet and the shop receipt, so a reward claimed
// from either screen behaves exactly the same.
//
// "gone" = the claim failed for a reason retrying can't fix (someone else got
// it, it expired); "error" = retryable.
export type ClaimStatus = "idle" | "gassing" | "claiming" | "done" | "error" | "gone";

export interface ClaimRequest {
  dropId: bigint;
  amount: bigint;
  address: string;
  userLocation: LatLng | null;
  /** Riddle drops only. */
  answer?: string;
}

export function useDropClaim(surface: ClaimSurface) {
  const { writeContractAsync, sponsored } = useSponsoredWrite();
  const [status, setStatus] = useState<ClaimStatus>("idle");
  const [errMsg, setErrMsg] = useState("");
  // An event drop before its event starts isn't an error, it's a "not yet".
  const [eventLocked, setEventLocked] = useState(false);
  // Guards a double start (an auto-claim and a tap landing together).
  const running = useRef(false);
  const statusRef = useRef<ClaimStatus>("idle");
  const set = (s: ClaimStatus) => { statusRef.current = s; setStatus(s); };

  const reset = useCallback(() => {
    if (running.current) return;
    set("idle"); setErrMsg(""); setEventLocked(false);
  }, []);

  /** Clear a retryable error (e.g. the riddle answer was edited). */
  const clearError = useCallback(() => {
    if (statusRef.current === "error") { set("idle"); setErrMsg(""); }
  }, []);

  const claim = useCallback(async (req: ClaimRequest) => {
    const cur = statusRef.current;
    if (running.current || (cur !== "idle" && cur !== "error")) return;
    running.current = true;
    const retrying = cur === "error";
    track("claim_started", { surface });
    set("claiming");
    setErrMsg("");

    const won = () => {
      set("done");
      track("claim_succeeded", { rarity: getDropRarity(req.amount), surface });
      fireChestReward(formatG$(req.amount), getDropRarity(req.amount));
      fetch("/api/engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: req.address }),
      })
        .then(() => window.dispatchEvent(new CustomEvent("gd:streak-updated")))
        .catch(() => {});
    };

    try {
      // After an unclear ending, look before trying again: the first claim may
      // have landed in the meantime.
      if (retrying) {
        const c = await checkBeforeRetry(req.dropId, req.address);
        if (c === "won") { won(); return; }
        if (c === "gone") throw new Error("already claimed");
      }
      // Gas BEFORE the proof, so a low wallet never fails mid-claim and the proof
      // stays fresh while any top-up lands. Sponsored wallets need none.
      if (!(await sponsored())) await ensureGasForClaim(req.address as `0x${string}`, () => set("gassing"));
      set("claiming");

      const proofRes = await fetch("/api/claim-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropId: req.dropId.toString(),
          claimer: req.address,
          userLat: req.userLocation?.lat,
          userLng: req.userLocation?.lng,
          ...(req.answer !== undefined ? { answer: req.answer } : {}),
        }),
      });
      if (!proofRes.ok) {
        const body = await proofRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not verify location. Try again.");
      }

      const { deadline, sig } = await proofRes.json();
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "claimWithProof",
        args: [req.dropId, BigInt(deadline), sig as `0x${string}`],
      }, { onToppingUp: () => set("gassing") });

      await confirmTx(tx);
      won();
    } catch (e: unknown) {
      const f = await settleClaimError(e, req.dropId, req.address);
      if (f.result === "won") { won(); return; }
      track("claim_failed", { reason: f.result === "pending" ? "pending" : claimFailReason(e), surface });
      // They just closed the wallet prompt: no error, let them tap again.
      if (f.result === "rejected") { set("idle"); setErrMsg(""); return; }
      if (f.result === "pending") { setErrMsg(f.message); set("error"); return; }
      setEventLocked(f.kind === "event");
      setErrMsg(f.message);
      set(f.gone ? "gone" : "error");
    } finally {
      running.current = false;
    }
  }, [surface, sponsored, writeContractAsync]);

  return { status, errMsg, eventLocked, claim, reset, clearError };
}
