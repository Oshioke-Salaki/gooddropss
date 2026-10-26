"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";

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
  const { status } = useAccount();
  const pathname = usePathname();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (preview) return;
    if (status !== "connecting" && status !== "reconnecting") { setDone(true); return; }
    const t = setTimeout(() => setDone(true), 4000);
    return () => clearTimeout(t);
  }, [status, preview]);

  // The admin console is gated by its own password cookie, not the wallet session,
  // so a wallet-session loader there is misleading — skip it on /admin.
  if (done || pathname?.startsWith("/admin")) return null;

  return (
    <div
      aria-busy="true"
      aria-label="Loading GoodDrops"
      className="fixed inset-0 z-[3000] bg-white flex flex-col items-center justify-center gap-5 font-sans"
    >
      {/* The GoodDrops face (same path as public/logo-mark-white.svg), breathing
          gently — a brand beat rather than a spinner. */}
      <svg
        viewBox="0 0 18 18"
        aria-hidden
        className="w-12 h-12 text-brand motion-safe:animate-pulse"
        fill="currentColor"
      >
        <path d="M16.4268 7.9482C16.0831 7.89997 15.732 7.875 15.375 7.875C12.9303 7.875 10.7591 9.0453 9.3909 10.8532C9.26258 10.8665 9.13223 10.8734 9 10.8734C8.0391 10.8734 7.16413 10.5129 6.50018 9.9186L5.49982 11.0363C6.31403 11.7651 7.35856 12.244 8.50995 12.3507C8.10172 13.2762 7.875 14.2997 7.875 15.375C7.875 15.732 7.89997 16.0831 7.9482 16.4268C4.30402 15.9154 1.5 12.7852 1.5 9C1.5 4.85786 4.85786 1.5 9 1.5C12.7852 1.5 15.9154 4.30402 16.4268 7.9482ZM16.403 9.46275C16.0691 9.40507 15.7255 9.375 15.375 9.375C13.3242 9.375 11.5134 10.4032 10.4301 11.9756C9.76455 12.9417 9.375 14.1117 9.375 15.375C9.375 15.7255 9.40507 16.0691 9.46275 16.403L16.403 9.46275ZM6.375 8.625C6.99632 8.625 7.5 8.1213 7.5 7.5C7.5 6.87868 6.99632 6.375 6.375 6.375C5.75368 6.375 5.25 6.87868 5.25 7.5C5.25 8.1213 5.75368 8.625 6.375 8.625ZM11.625 8.625C12.2463 8.625 12.75 8.1213 12.75 7.5C12.75 6.87868 12.2463 6.375 11.625 6.375C11.0037 6.375 10.5 6.87868 10.5 7.5C10.5 8.1213 11.0037 8.625 11.625 8.625Z" />
      </svg>
      <span className="text-xl/none text-heading">GoodDrops</span>
      <span className="sr-only">Loading</span>
    </div>
  );
}
