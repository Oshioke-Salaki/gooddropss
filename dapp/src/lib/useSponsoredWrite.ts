"use client";
import { useCallback, useEffect } from "react";
import { useAccount, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { ensureGasForClaim } from "@/lib/ensureGas";
import { track } from "@/lib/analytics";
import {
  canSponsor, policyAllows, sendSponsored, toCall, SponsorUnavailableError, type WriteParams,
} from "@/lib/sponsor";

export type WriteOptions = {
  /** Called if we fall back to the user's own gas and start a faucet top-up. */
  onToppingUp?: () => void;
};

/**
 * Drop-in for wagmi's useWriteContract().writeContractAsync.
 *
 * For a Magic wallet with sponsorship available, the call goes through the
 * sponsored smart-account path (no CELO needed). Everyone else, and any Magic
 * user when sponsorship is unavailable, gets exactly the old behaviour: a normal
 * wallet transaction, with a faucet top-up first if they're short on gas.
 *
 * The returned hash is already mined and successful for sponsored sends, so the
 * callers' waitForTransactionReceipt resolves immediately and their receipt log
 * parsing (DropCreated etc.) works unchanged.
 */
export function useSponsoredWrite() {
  const { writeContractAsync: wagmiWrite } = useWriteContract();
  const { address, connector } = useAccount();
  const connectorId = connector?.id;

  // Warm Magic's iframe and session lookup as soon as a Magic wallet is
  // connected, so the first claim tap doesn't pay for loading it.
  useEffect(() => {
    if (connectorId !== "magic" || !address) return;
    const t = setTimeout(() => { void canSponsor(address, connectorId); }, 1500);
    return () => clearTimeout(t);
  }, [address, connectorId]);

  const sponsored = useCallback(
    () => canSponsor(address, connectorId),
    [address, connectorId],
  );

  const writeContractAsync = useCallback(async (p: WriteParams, opts?: WriteOptions): Promise<Hex> => {
    // The normal path. Callers that can show a top-up (the claim flows) always
    // get a gas check first: it returns at once when the balance is enough, and
    // covers the case where they skipped the faucet expecting sponsorship.
    const normal = async () => {
      if (opts?.onToppingUp && address) await ensureGasForClaim(address as Address, opts.onToppingUp);
      return wagmiWrite(p as never) as Promise<Hex>;
    };

    const call = toCall(p);
    if (address && (await canSponsor(address, connectorId)) && (await policyAllows(address as Address, [call]))) {
      try {
        const hash = await sendSponsored(address as Address, [call], () =>
          publicClient.simulateContract({ ...p, account: address as Address } as never),
        );
        track("tx_sponsored", { fn: p.functionName });
        return hash;
      } catch (e) {
        if (!(e instanceof SponsorUnavailableError)) throw e;
        track("tx_sponsor_fallback", { fn: p.functionName });
        // Nothing was sent: continue on the user's own gas, topping up first.
        if (!opts?.onToppingUp) await ensureGasForClaim(address as Address);
        return normal();
      }
    }
    return normal();
  }, [wagmiWrite, address, connectorId]);

  return { writeContractAsync, sponsored };
}
