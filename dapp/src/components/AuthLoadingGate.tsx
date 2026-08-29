"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Loader2 } from "lucide-react";

// Full-screen branded loader shown while wagmi restores the session on a fresh
// page load (hard refresh / first paint). It renders by default — identically on
// the server and the first client render, so there's no hydration mismatch — and
// reveals the app the moment wagmi settles (connected OR disconnected), with a
// safety cap so a stalled connector probe can never trap the user on the loader.
//
// Mounted once in Providers, so client-side navigations don't re-trigger it —
// only a real reload does, which is exactly when a connected user is re-loading.
export function AuthLoadingGate() {
  const { status } = useAccount();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (status !== "connecting" && status !== "reconnecting") { setDone(true); return; }
    const t = setTimeout(() => setDone(true), 4000);
    return () => clearTimeout(t);
  }, [status]);

  if (done) return null;

  return (
    <div
      aria-busy="true"
      aria-label="Loading GoodDrops"
      style={{
        position: "fixed", inset: 0, zIndex: 3000,
        background: "#f5f4f0",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 900, fontSize: 26, letterSpacing: "-0.02em", color: "#111" }}>
        <span>good</span>
        <span style={{ background: "#111", color: "#BFFD00", padding: "2px 8px", fontSize: 20, borderRadius: 2 }}>drops.</span>
      </div>
      <Loader2 size={26} color="#111" style={{ animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
