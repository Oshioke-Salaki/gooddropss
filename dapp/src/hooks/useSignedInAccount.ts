"use client";
import { useAccount } from "wagmi";

/**
 * The app's single source of truth for "is a user signed in, and who".
 *
 * With Magic + injected as wagmi connectors, wagmi is now the *only* auth source,
 * so this is a thin wrapper over `useAccount()`. (Previously it had to reconcile
 * wagmi against Privy, which could report a stale connector after logout — that
 * whole class of bug is gone now.)
 */
export function useSignedInAccount(): { address: `0x${string}` | undefined; isConnected: boolean } {
  const { address, isConnected } = useAccount();
  return { address: isConnected ? address : undefined, isConnected };
}
