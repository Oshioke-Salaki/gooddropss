"use client";
import { PrivyProvider } from "@privy-io/react-auth";

// Wraps the app in the LEGACY Focus-Pet Privy app so returning Privy users
// re-derive their original embedded wallet (same app ID + email = same wallet).
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // If Privy isn't configured we still render — Magic + Web3Auth paths work
  // without it; only the Privy legacy path needs this provider.
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "light", accentColor: "#BFFD00" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
