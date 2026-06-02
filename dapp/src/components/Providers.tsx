"use client";
import { useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { celo } from "viem/chains";
import { wagmiConfig } from "@/lib/wagmi";

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
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
