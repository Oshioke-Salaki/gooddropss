"use client";
import { useEffect } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";

const IDENTITY_ADDRESS =
  "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;

const IDENTITY_ABI = [
  {
    name: "isWhitelisted",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export function useGoodDollarProfile() {
  const { address } = useAccount();

  const { data, refetch } = useReadContracts({
    contracts: [
      {
        address: G_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address!],
      },
      {
        address: IDENTITY_ADDRESS,
        abi: IDENTITY_ABI,
        functionName: "isWhitelisted",
        args: [address!],
      },
    ],
    query: {
      enabled: !!address,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  // Listen for the gd:verified custom event dispatched by Nav when verification succeeds.
  // This immediately refreshes all profile instances without waiting for the next interval.
  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener("gd:verified", handler);
    return () => window.removeEventListener("gd:verified", handler);
  }, [refetch]);

  const balance = (data?.[0]?.result as bigint | undefined) ?? 0n;
  const isVerified = (data?.[1]?.result as boolean | undefined) ?? false;

  return { balance, isVerified, isFetching: !address || data === undefined };
}
