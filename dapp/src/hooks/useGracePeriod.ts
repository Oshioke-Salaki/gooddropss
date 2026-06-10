"use client";
import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { fetchHunterProfile } from "@/lib/subgraph";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";

export const GRACE_CLAIM_LIMIT = 30;

export function useGracePeriod() {
  const { address } = useAccount();

  // Read the contract's identityRequired flag. If true, the chain enforces
  // verification regardless of our UI — the grace period only works when false.
  const { data: contractRequiresIdentity } = useReadContract({
    address: GOOD_DROPS_ADDRESS,
    abi: GOOD_DROPS_ABI,
    functionName: "identityRequired",
    query: { staleTime: 60_000 },
  });

  // Fetch how many drops this user has already claimed from the subgraph.
  // Defaults to null while loading (treated as "within grace period" so we don't
  // flash a false "verification required" on first render).
  const [claimCount, setClaimCount] = useState<number | null>(null);

  useEffect(() => {
    if (!address) { setClaimCount(0); return; }
    let cancelled = false;
    fetchHunterProfile(address)
      .then((profile) => {
        if (!cancelled) setClaimCount(profile?.dropsClaimed.length ?? 0);
      })
      .catch(() => { if (!cancelled) setClaimCount(0); });
    return () => { cancelled = true; };
  }, [address]);

  // contractRequiresIdentity = undefined while loading — treat as true (safe default)
  const contractEnforces = contractRequiresIdentity !== false;

  // Within grace: contract must NOT enforce identity, AND user has < 10 claims.
  // While claimCount is null (still fetching), optimistically allow the action.
  const inGrace  = !contractEnforces && (claimCount === null || claimCount < GRACE_CLAIM_LIMIT);
  const used     = claimCount ?? 0;
  const left     = Math.max(0, GRACE_CLAIM_LIMIT - used);
  const loading  = claimCount === null;

  return { claimCount, inGrace, used, left, loading, contractEnforces };
}
