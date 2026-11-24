"use client";
import { useState, useEffect, useRef } from "react";
import { WagmiProvider, useAccount, useSwitchChain } from "wagmi";
import { celo } from "viem/chains";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { AuthProvider } from "@/hooks/useAuth";
import { AuthLoadingGate } from "@/components/AuthLoadingGate";
import { ValoraDeepLink } from "@/components/ValoraDeepLink";
import { ReferralCapture } from "@/components/ReferralCapture";
import { ReferralAutoCredit } from "@/components/ReferralAutoCredit";
import { GasTopup } from "@/components/GasTopup";
import { BadgeCelebration } from "@/components/BadgeCelebration";
import { installClientErrorReporter } from "@/lib/clientErrors";
import { Toaster } from "@/components/ui/Toaster";
import dynamic from "next/dynamic";
import { LazyMotion } from "framer-motion";

const loadMotion = () => import("@/lib/motionFeatures").then((m) => m.default);

// Always mounted, but they only act after a sign-in, a claim or a tap, so they
// load right after the page starts instead of delaying it.
const ProfileSetup = dynamic(() => import("@/components/profile/ProfileSetup").then((m) => m.ProfileSetup), { ssr: false });
const UbiPrompt = dynamic(() => import("@/components/UbiPrompt").then((m) => m.UbiPrompt), { ssr: false });
const FirstDropNudge = dynamic(() => import("@/components/FirstDropNudge").then((m) => m.FirstDropNudge), { ssr: false });
const FlowVotePrompt = dynamic(() => import("@/components/FlowVotePrompt").then((m) => m.FlowVotePrompt), { ssr: false });
const ProfileDrawerHost = dynamic(() => import("@/components/profile/ProfileDrawer").then((m) => m.ProfileDrawerHost), { ssr: false });
const ChestReward = dynamic(() => import("@/components/ChestReward").then((m) => m.ChestReward), { ssr: false });

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
  // 30 s: chain reads (balances, identity, limits) don't need refetching on every
  // mount and tab focus; writes and claims refetch explicitly.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));
  // Uncaught client errors are reported to /api/client-error (see lib/clientErrors).
  useEffect(() => { installClientErrorReporter(); }, []);

  return (
    // reconnectOnMount restores the Magic (or wallet) session automatically on
    // every load, so a signed-in user never has to reconnect.
    // Animations use framer-motion's small "m" components; the engine loads just
    // after the page starts. `strict` fails loudly if a full "motion" sneaks in.
    <LazyMotion features={loadMotion} strict>
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthLoadingGate />
          <ValoraDeepLink />
          <QueryCacheManager />
          <ChainGuard />
          <ReferralCapture />
          <ReferralAutoCredit />
          <GasTopup />
          <BadgeCelebration />
          <ChestReward />
          {children}
          {/* Profile setup: auto-offers an avatar (then a name) to anyone signed in
              without one, and hosts the "set a name" sheet any surface can open
              via the gd:setName event (wallet pill, post-claim screen, leaderboard). */}
          <ProfileSetup />
          <UbiPrompt />
          <FirstDropNudge />
          <FlowVotePrompt />
          <ProfileDrawerHost />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
    </LazyMotion>
  );
}
