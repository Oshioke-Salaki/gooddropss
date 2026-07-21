"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";

/**
 * /me — the connected user's own hunter profile. Redirects to /hunter/<address>
 * once we know who's signed in, so "View my profile" links are stable and don't
 * need to know the address. Shows a sign-in prompt when logged out.
 */
export default function MePage() {
  const { address } = useAccount();
  const { authenticated, login, ready } = useAuth();
  const router = useRouter();

  const connected = authenticated && !!address;

  useEffect(() => {
    if (connected && address) router.replace(`/hunter/${address.toLowerCase()}`);
  }, [connected, address, router]);

  return (
    <div
      style={{
        minHeight: "100dvh", background: "#f5f4f0",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 14, padding: 24, textAlign: "center",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div style={{ fontSize: 46 }}>{connected ? "⏳" : "👤"}</div>
      {connected ? (
        <p style={{ fontWeight: 800, color: "#5a5a5a", margin: 0 }}>Opening your profile…</p>
      ) : (
        <>
          <p style={{ fontWeight: 900, fontSize: 22, color: "#111", margin: 0 }}>Your hunter profile</p>
          <p style={{ color: "#5a5a5a", margin: 0, maxWidth: 300 }}>
            Sign in to see your stats, achievements, streak and every G$ you&apos;ve found.
          </p>
          <button
            onClick={() => login()}
            disabled={!ready}
            style={{
              marginTop: 8, padding: "13px 26px",
              background: "#BFFD00", color: "#111",
              border: "2.5px solid #111", borderRadius: 14,
              boxShadow: "4px 4px 0 #111",
              fontWeight: 900, fontSize: 15, fontFamily: "inherit",
              cursor: ready ? "pointer" : "wait",
            }}
          >
            Sign in →
          </button>
        </>
      )}
    </div>
  );
}
