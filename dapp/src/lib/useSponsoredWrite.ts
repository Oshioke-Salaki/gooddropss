"use client";
import { useCallback, useEffect } from "react";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { getCapabilities, sendCalls, waitForCallsStatus } from "wagmi/actions";
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
  const config = useConfig();
  const { address, connector } = useAccount();
  const connectorId = connector?.id;

  // Warm Magic's iframe and session lookup as soon as a Magic wallet is
  // connected, so the first claim tap doesn't pay for loading it.
  useEffect(() => {
    if ((connectorId !== "magic" && connectorId !== "magic-partner") || !address) return;
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
        connectorId);
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

  /** Does the connected wallet say it can send a batch atomically on Celo? */
  const canBatch = useCallback(async (account: Address): Promise<boolean> => {
    try {
      const caps = (await getCapabilities(config, { account, chainId: 42220 })) as { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } };
      return caps?.atomic?.status === "supported" || caps?.atomic?.status === "ready" || caps?.atomicBatch?.supported === true;
    } catch { return false; } // most wallets don't answer this yet
  }, [config]);

  /**
   * Several writes that belong together. Sponsored Magic wallets send them as
   * ONE transaction (all or nothing) and get one hash back. Everyone else sends
   * them one after another, in order, each confirmed before the next, and gets
   * a hash per write; if a later one fails, the earlier ones have still happened.
   */
  const writeBatchAsync = useCallback(async (steps: WriteParams[], opts?: WriteOptions): Promise<Hex[]> => {
    const calls = steps.map(toCall);
    if (address && (await canSponsor(address, connectorId)) && (await policyAllows(address as Address, calls))) {
      try {
        const hash = await sendSponsored(address as Address, calls, () =>
          publicClient.simulateContract({ ...steps[0], account: address as Address } as never),
        connectorId);
        track("tx_sponsored", { fn: steps.map((x) => x.functionName).join("+") });
        return [hash];
      } catch (e) {
        if (!(e instanceof SponsorUnavailableError)) throw e;
        track("tx_sponsor_fallback", { fn: steps.map((x) => x.functionName).join("+") });
      }
    }
    if (opts?.onToppingUp && address) await ensureGasForClaim(address as Address, opts.onToppingUp);
    else if (address) await ensureGasForClaim(address as Address);

    // Wallets that can send several actions as one (EIP-5792): one approval,
    // all or nothing. Anything else falls through to one approval per write.
    if (steps.length > 1 && address && (await canBatch(address as Address))) {
      const { id } = await sendCalls(config, { calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value })), forceAtomic: true });
      const res = await waitForCallsStatus(config, { id, timeout: 180_000 });
      const hash = res.receipts?.[0]?.transactionHash as Hex | undefined;
      if (res.status !== "success" || !hash) throw Object.assign(new Error("batch failed"), { hashes: hash ? [hash] : [] });
      return [hash];
    }

    const hashes: Hex[] = [];
    for (const p of steps) {
      // On any problem after the first write, `hashes` says what already went out.
      try {
        const h = (await wagmiWrite(p as never)) as Hex;
        hashes.push(h);
        const rc = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
        if (rc.status !== "success") throw new Error("reverted");
      } catch (e) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { hashes: [...hashes] });
      }
    }
    return hashes;
  }, [wagmiWrite, address, connectorId, config, canBatch]);

  return { writeContractAsync, writeBatchAsync, sponsored };
}
