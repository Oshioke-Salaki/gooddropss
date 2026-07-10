"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { Connector } from "wagmi";
import { celo } from "viem/chains";
import { Mail, Wallet, X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

// Login sheet. "Continue with email" hands off to Magic's own dialog (email +
// secure code) — the documented, reliable connector flow. "Connect a wallet"
// lists every detected wallet (EIP-6963 discovery). Both feed one wagmi session.
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connectors, isPending } = useConnect();
  const { isConnected } = useAccount();

  const [view, setView] = useState<"main" | "wallets">("main");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const magic = connectors.find((c) => c.id === "magic");

  // Wallet connectors = everything except Magic. EIP-6963 discovery adds named
  // wallets (id = rdns); prefer those and drop the generic `injected` fallback.
  const nonMagic = connectors.filter((c) => c.id !== "magic");
  const named    = nonMagic.filter((c) => c.id !== "injected");
  const walletConnectors: readonly Connector[] = named.length > 0 ? named : nonMagic;

  useEffect(() => { if (open && isConnected) onClose(); }, [open, isConnected, onClose]);
  useEffect(() => { if (!open) { setView("main"); setPendingId(null); } }, [open]);
  useEffect(() => { if (!isPending) setPendingId(null); }, [isPending]);

  if (!open) return null;

  function pick(c: Connector) {
    setPendingId(c.id);
    // Request Celo so external wallets are switched to the right chain on connect.
    connect({ connector: c, chainId: celo.id });
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(17,17,17,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise"
        style={{
          width: "100%", maxWidth: 440,
          background: "#fff", border: "2.5px solid #111",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 -6px 0 #111",
          padding: "22px 22px calc(28px + env(safe-area-inset-bottom, 0px))",
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {view === "wallets" && (
              <button onClick={() => setView("main")} aria-label="Back" style={roundBtn}>
                <ChevronLeft size={17} />
              </button>
            )}
            <p style={{ margin: 0, fontWeight: 900, fontSize: 20, letterSpacing: "-0.02em" }}>
              {view === "main" ? "Sign in to GoodDrops" : "Choose a wallet"}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={roundBtn}>
            <X size={16} />
          </button>
        </div>

        {view === "main" ? (
          <>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "#5a5a5a", lineHeight: 1.5 }}>
              Hide and hunt real G$ anywhere in the world.
            </p>

            {/* Email via Magic's own dialog */}
            <button
              onClick={() => { if (magic) pick(magic); }}
              disabled={isPending || !magic}
              style={{
                width: "100%", padding: "16px",
                background: "#BFFD00", color: "#111",
                border: "2.5px solid #111", borderRadius: 16,
                boxShadow: "4px 4px 0 #111",
                fontWeight: 900, fontSize: 16, cursor: isPending ? "wait" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {pendingId === "magic" ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
              Continue with email
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0" }}>
              <span style={{ flex: 1, height: 1.5, background: "#e8e6e0" }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em" }}>or</span>
              <span style={{ flex: 1, height: 1.5, background: "#e8e6e0" }} />
            </div>

            {/* Wallet */}
            <button
              onClick={() => {
                if (walletConnectors.length === 1) pick(walletConnectors[0]);
                else setView("wallets");
              }}
              disabled={isPending || walletConnectors.length === 0}
              style={{
                width: "100%", padding: "14px",
                background: "#fff", color: "#111",
                border: "2px solid #111", borderRadius: 14,
                fontWeight: 800, fontSize: 14, cursor: "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: walletConnectors.length === 0 ? 0.5 : 1,
              }}
            >
              <Wallet size={16} />
              {walletConnectors.length === 0 ? "No wallet detected" : "Connect a wallet"}
              {walletConnectors.length > 1 && <ChevronRight size={15} style={{ marginLeft: "auto" }} />}
            </button>

            <p style={{ margin: "16px 0 0", fontSize: 11, color: "#999", textAlign: "center", lineHeight: 1.5 }}>
              Email creates a secure wallet for you automatically. No seed phrase needed.
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "#5a5a5a", lineHeight: 1.5 }}>
              Connect the wallet that holds your G$.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {walletConnectors.map((c) => (
                <button
                  key={c.uid}
                  onClick={() => pick(c)}
                  disabled={isPending}
                  style={{
                    width: "100%", padding: "13px 16px",
                    background: "#fff", color: "#111",
                    border: "2px solid #111", borderRadius: 14,
                    fontWeight: 800, fontSize: 15, cursor: isPending ? "wait" : "pointer",
                    fontFamily: "inherit", display: "flex", alignItems: "center", gap: 12,
                    boxShadow: "2px 2px 0 #111",
                  }}
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" width={26} height={26} style={{ borderRadius: 6, flexShrink: 0 }} />
                  ) : (
                    <span style={{
                      width: 26, height: 26, borderRadius: 6, background: "#111", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Wallet size={15} color="#BFFD00" />
                    </span>
                  )}
                  <span style={{ flex: 1, textAlign: "left" }}>{c.name}</span>
                  {pendingId === c.id
                    ? <Loader2 size={16} className="animate-spin" />
                    : <ChevronRight size={16} color="#aaa" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const roundBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%", border: "none",
  background: "#f5f4f0", cursor: "pointer", color: "#888",
  display: "flex", alignItems: "center", justifyContent: "center",
};
