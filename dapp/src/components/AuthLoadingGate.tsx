"use client";
import { usePathname } from "next/navigation";
import { useSessionRestore } from "@/hooks/useSessionRestore";
import { BrandLoader } from "@/components/BrandLoader";

// Full-screen branded loader shown while wagmi restores the session on a fresh
// page load (hard refresh / first paint). It renders by default — identically on
// the server and the first client render, so there's no hydration mismatch — and
// reveals the app the moment wagmi settles (connected OR disconnected), with a
// safety cap so a stalled connector probe can never trap the user on the loader.
//
// Mounted once in Providers, so client-side navigations don't re-trigger it —
// only a real reload does, which is exactly when a connected user is re-loading.
//
// `preview` keeps it on screen for design QA; production never passes it.
export function AuthLoadingGate({ preview = false }: { preview?: boolean } = {}) {
  const pathname = usePathname();
  // Shown only while a saved session is being restored (see useSessionRestore):
  // returning signed-in users see the brand, never a "Sign in" button that is
  // about to turn into their wallet. New visitors go straight in.
  const { restoring } = useSessionRestore();
  const done = !preview && !restoring;

  // The admin console is gated by its own password cookie, not the wallet session,
  // so a wallet-session loader there is misleading — skip it on /admin.
  // The Google return page draws this same screen itself while it signs you in.
  if (done || pathname?.startsWith("/admin") || pathname?.startsWith("/auth/callback")) return null;

  return (
    // Fades in only if restoring takes a moment, so a visitor with nothing
    // to restore never sees it flash while the page hydrates.
    <BrandLoader style={{ animation: preview ? undefined : "gd-gate-in 200ms ease 300ms both" }} />
  );
}
