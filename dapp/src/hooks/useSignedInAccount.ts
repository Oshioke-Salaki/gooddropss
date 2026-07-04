"use client";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Auth-correct replacement for wagmi's `useAccount()`.
 *
 * Privy is the source of truth for whether a user is signed in. Wagmi persists
 * its last connector in localStorage and silently reconnects on load, so it can
 * report `isConnected: true` with a leftover `address` even after the user has
 * signed out of Privy. Reading wagmi directly therefore surfaces stale, wrong
 * user data (someone else's drops, streaks, claim UI).
 *
 * This hook returns `isConnected` only when Privy is authenticated AND an address
 * exists, and nulls out the address otherwise — so components never act on a
 * stale identity.
 */
export function useSignedInAccount(): { address: `0x${string}` | undefined; isConnected: boolean } {
  const { address } = useAccount();
  const { authenticated } = usePrivy();
  const isConnected = authenticated && !!address;
  return { address: isConnected ? address : undefined, isConnected };
}
