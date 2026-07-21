"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { publicClient } from "@/lib/publicClient";
import { readIdentityStatus, isExpiringSoon, NONE, type IdentityStatus } from "@/lib/identity";

// Replaces the old "getWhitelistedRoot() != 0 ⇒ verified, else not verified"
// check, which collapsed two very different situations into one message:
//
//   • never verified          → "Verify to claim"
//   • verified but LAPSED     → "Re-verify — it only takes a minute"
//
// GoodDollar gives first-time verifiers a 3-day window, so the second case is
// the common one, not an edge case. Telling those users they aren't verified is
// wrong and makes the app look broken to someone who already did the face scan.
export function useIdentityStatus() {
  const { address } = useAccount();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["identity-status", address?.toLowerCase()],
    queryFn: async (): Promise<IdentityStatus> => {
      if (!address) return NONE;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return readIdentityStatus(publicClient as any, address);
    },
    enabled: !!address,
    staleTime: 60_000,
    gcTime: 300_000,
    // A transient RPC failure must not silently read as "not verified" — retry a
    // couple of times before giving up, and don't refetch on window focus (which
    // used to blank the status back to "unknown" mid-session).
    retry: 2,
    refetchOnWindowFocus: false,
    // Keep the last known status visible while a refetch runs, so a verified user
    // never flickers to "unknown" (which the UI renders as "verify required").
    placeholderData: keepPreviousData,
  });

  const status = data ?? NONE;

  // "We don't know yet" — no cached answer AND a read in flight. Callers use this
  // to avoid telling a verified user to verify before the check has resolved.
  const isChecking = !!address && (isLoading || (data === undefined && isFetching));

  return {
    status,
    isLoading: isChecking,
    isVerified:    status.state === "verified",
    isLapsed:      status.state === "lapsed",
    isBlacklisted: status.state === "blacklisted",
    neverVerified: status.state === "none",
    expiringSoon:  isExpiringSoon(status),
    refresh: refetch,
  };
}
