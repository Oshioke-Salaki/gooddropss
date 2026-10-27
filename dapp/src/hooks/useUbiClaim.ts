"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useIdentitySDK } from "@goodsdks/identity-sdk";
import { makeClaimSDK, makeIdentitySDK } from "@/lib/goodSdk";
import { friendlyUbiError } from "@/lib/claimErrors";

export type UbiStatus = "loading" | "can_claim" | "already_claimed" | "not_whitelisted" | "error";

export type UbiState = {
  status: UbiStatus;
  /** Today's claimable amount (wei), when the SDK reports one. */
  entitlement: bigint | null;
  claiming: boolean;
  /** Amount claimed in this session, for the success line. */
  claimed: bigint | null;
  error: string;
};

const INITIAL: UbiState = { status: "loading", entitlement: null, claiming: false, claimed: null, error: "" };

// One shared state per address, so the load-time prompt and the wallet modal
// show the same thing: claim in one, the other already says "claimed".
const states = new Map<string, UbiState>();
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();

const get = (a: string) => states.get(a) ?? INITIAL;
function set(a: string, patch: Partial<UbiState>) {
  states.set(a, { ...get(a), ...patch });
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Daily GoodDollar UBI for the connected wallet: whether today's G$ is waiting,
 * how much, and a claim action with its own pending / success / error state.
 */
export function useUbiClaim() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const identityHook = useIdentitySDK("production");
  const queryClient = useQueryClient();
  const key = address?.toLowerCase() ?? "";

  const state = useSyncExternalStore(subscribe, () => (key ? get(key) : INITIAL), () => INITIAL);

  const sdk = useCallback(() => {
    if (!address || !publicClient || !walletClient) return null;
    const identitySDK = identityHook ?? makeIdentitySDK(publicClient, walletClient);
    return makeClaimSDK({ account: address, publicClient, walletClient, identitySDK });
  }, [address, publicClient, walletClient, identityHook]);

  // Load once per address per page session; every caller shares the result.
  useEffect(() => {
    if (!key || states.has(key) || loading.has(key)) return;
    const s = sdk();
    if (!s) return;
    const p = s.getWalletClaimStatus()
      .then((r) => set(key, { status: r.status, entitlement: r.entitlement ?? null }))
      .catch(() => set(key, { status: "error" }))
      .finally(() => loading.delete(key));
    loading.set(key, p);
  }, [key, sdk]);

  const claim = useCallback(async (): Promise<boolean> => {
    const s = sdk();
    if (!key || !s || get(key).claiming) return false;
    set(key, { claiming: true, error: "" });
    try {
      await s.claim();
      set(key, { claiming: false, status: "already_claimed", claimed: get(key).entitlement });
      // Balances shown anywhere in the app are wagmi queries: refresh them.
      void queryClient.invalidateQueries();
      return true;
    } catch (e) {
      set(key, { claiming: false, error: friendlyUbiError(e) });
      return false;
    }
  }, [key, sdk, queryClient]);

  return { ...state, claim };
}
