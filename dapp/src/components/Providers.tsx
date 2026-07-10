"use client";
import { useState, useEffect, useRef } from "react";
import { WagmiProvider, useAccount, useSwitchChain } from "wagmi";
import { celo } from "viem/chains";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { AuthProvider } from "@/hooks/useAuth";

// Keep every connected wallet on Celo. Auto-switches once whenever a wrong chain
// is detected (on connect, or if the user changes networks in their wallet). The
// ref guards against re-prompting in a loop if the user rejects the switch.
function ChainGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const attemptedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isConnected || !chainId || chainId === celo.id) {
      attemptedRef.current = null;
      return;
    }
    if (attemptedRef.current === chainId) return; // already attempted for this chain
    attemptedRef.current = chainId;
    switchChain({ chainId: celo.id });
  }, [isConnected, chainId, switchChain]);

  return null;
}

// Clears cached contract/query data whenever the connected wallet changes, so a
// previous session's balance/verification reads are never shown to a new user.
function QueryCacheManager() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    const current = address ?? null;
    if (prevRef.current !== null && prevRef.current !== current) {
      queryClient.clear();
    }
    prevRef.current = current;
  }, [address, queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    // reconnectOnMount restores the Magic (or wallet) session automatically on
    // every load, so a signed-in user never has to reconnect.
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <QueryCacheManager />
          <ChainGuard />
          {children}
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
