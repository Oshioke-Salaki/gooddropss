"use client";
import { useState, useEffect, useRef } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { celo } from "viem/chains";
import { wagmiConfig } from "@/lib/wagmi";

// Clears all cached contract/query data whenever the authenticated user changes.
// Without this, balance + verification reads from a previous wallet session
// remain in cache and are shown to the newly logged-in user.
function QueryCacheManager() {
  const { user, authenticated } = usePrivy();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentId = authenticated ? (user?.id ?? null) : null;
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentId) {
      // User changed (logout, or switched account) — purge stale cache
      queryClient.clear();
    }
    prevUserIdRef.current = currentId;
  }, [authenticated, user?.id, queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        defaultChain: celo,
        supportedChains: [celo],
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#BFFD00",
          logo: "https://gooddrops.xyz/icon-192.png",
          landingHeader: "Hunt hidden G$",
          loginMessage: "Connect to hide and hunt real G$ anywhere in the world.",
          walletList: ["metamask", "rainbow", "coinbase_wallet", "wallet_connect"],
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <QueryCacheManager />
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
