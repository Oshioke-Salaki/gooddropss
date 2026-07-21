"use client";
import { useQuery } from "@tanstack/react-query";
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

  const { data, isLoading, isError, refetch } = useQuery({
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
    // NB: deliberately NOT keepPreviousData. It would show the PREVIOUS wallet's
    // status as a placeholder after an account switch, briefly presenting the old
    // wallet's verified state on the new one. A same-address background refetch
    // already keeps its cached data (isLoading stays false), so we lose no
    // smoothness by omitting it — and we avoid the cross-wallet bleed.
  });

  const status = data ?? NONE;

  // "We don't know yet" for THIS address: no cached answer and a first read in
  // flight (isLoading is true only when there's no cached data for the current
  // query key — so switching to an uncached wallet counts, but a background
  // refetch of an already-known wallet does not). Callers use this to avoid
  // telling a possibly-verified user to verify before the check has resolved.
  // On a hard failure (all RPCs down + retries exhausted) isLoading goes false
  // with no data — isError then distinguishes "couldn't check" from "not verified".
  const isChecking = !!address && isLoading;

  return {
    status,
    isLoading: isChecking,
    // The on-chain read failed outright (not merely "not verified"). Lets the UI
    // offer a retry instead of wrongly sending a verified user to re-verify.
    checkFailed:   !!address && isError && data === undefined,
    isVerified:    status.state === "verified",
    isLapsed:      status.state === "lapsed",
    isBlacklisted: status.state === "blacklisted",
    neverVerified: status.state === "none",
    expiringSoon:  isExpiringSoon(status),
    refresh: refetch,
  };
}
