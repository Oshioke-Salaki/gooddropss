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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["identity-status", address?.toLowerCase()],
    queryFn: async (): Promise<IdentityStatus> => {
      if (!address) return NONE;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return readIdentityStatus(publicClient as any, address);
    },
    enabled: !!address,
    staleTime: 30_000,
  });

  const status = data ?? NONE;

  return {
    status,
    isLoading: !!address && isLoading,
    isVerified:    status.state === "verified",
    isLapsed:      status.state === "lapsed",
    isBlacklisted: status.state === "blacklisted",
    neverVerified: status.state === "none",
    expiringSoon:  isExpiringSoon(status),
    refresh: refetch,
  };
}
