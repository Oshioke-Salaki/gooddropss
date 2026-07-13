"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { Connector } from "wagmi";
import { celo } from "viem/chains";
import { Mail, Wallet, X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

// Login sheet. "Continue with email" hands off to Magic's own dialog (email +
// secure code) — the documented, reliable connector flow. "Connect a wallet"
// lists every detected wallet (EIP-6963 discovery). Both feed one wagmi session.
// The Magic SDK instance the connector owns (it's built with OAuthExtension).
// Reusing it — rather than making a second one — is what makes Google work.
type MagicSdk = {
  oauth2?: {
    loginWithRedirect: (o: { provider: string; redirectURI: string }) => Promise<unknown>;
  };
};

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.05 6.05 29.3 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.05 6.05 29.3 4 24 4 16.3 4 9.65 8.34 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C39.9 35.9 44 30.6 44 24c0-1.34-.14-2.65-.4-3.5z"/>
    </svg>
  );
}

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connectors, isPending } = useConnect();
  const { isConnected } = useAccount();

  const [view, setView] = useState<"main" | "wallets">("main");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [err, setErr] = useState("");

  const magic = connectors.find((c) => c.id === "magic");

  // Wallet connectors = everything except Magic. EIP-6963 discovery adds named
  // wallets (id = rdns); prefer those and drop the generic `injected` fallback.
  const nonMagic = connectors.filter((c) => c.id !== "magic");
  const named    = nonMagic.filter((c) => c.id !== "injected");
  const walletConnectors: readonly Connector[] = named.length > 0 ? named : nonMagic;

  useEffect(() => { if (open && isConnected) onClose(); }, [open, isConnected, onClose]);
  useEffect(() => { if (!open) { setView("main"); setPendingId(null); setErr(""); setGoogleBusy(false); } }, [open]);
  useEffect(() => { if (!isPending) setPendingId(null); }, [isPending]);

  if (!open) return null;

  function pick(c: Connector) {
    setPendingId(c.id);
    // Request Celo so external wallets are switched to the right chain on connect.
    connect({ connector: c, chainId: celo.id });
  }

  // Google sign-in. Uses the connector's OWN Magic instance (it always includes
  // OAuthExtension) so there's a single shared session.
  //
  // The redirectURI MUST be one fixed URL — Google matches redirect URIs exactly,
  // so sending window.location.href (which changes per page, and carries a
  // trailing slash) fails with redirect_uri_mismatch. We always return to
  // /auth/callback, which completes the login and sends the user back where they
  // started.
  async function loginWithGoogle() {
    if (!magic || googleBusy) return;
    const sdk = (magic as unknown as { magic?: MagicSdk }).magic;
    if (!sdk?.oauth2?.loginWithRedirect) {
      setErr("Google sign-in is unavailable right now. Please use email.");
      return;
    }
    setGoogleBusy(true);
    setErr("");
    try {
      // Remember where they were so the callback can send them back.
      sessionStorage.setItem("gd:returnTo", window.location.pathname + window.location.search);
      await sdk.oauth2.loginWithRedirect({
        provider: "google",
        redirectURI: `${window.location.origin}/auth/callback`,
      });
      // navigating away to Google…
    } catch {
      setGoogleBusy(false);
      setErr("Couldn't start Google sign-in. Please try again.");
    }
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

            {err && (
              <p style={{
                margin: "0 0 12px", padding: "10px 12px",
                background: "#FFE5E5", border: "1.5px solid #FF3B3B",
                borderRadius: 12, color: "#C81E1E", fontSize: 13, fontWeight: 600,
              }}>
                {err}
              </p>
            )}

            {/* Google — primary path: no OTP email, so no spam-folder risk */}
            <button
              onClick={loginWithGoogle}
              disabled={isPending || googleBusy || !magic}
              style={{
                width: "100%", padding: "16px",
                background: "#BFFD00", color: "#111",
                border: "2.5px solid #111", borderRadius: 16,
                boxShadow: "4px 4px 0 #111",
                fontWeight: 900, fontSize: 16,
                cursor: googleBusy ? "wait" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              }}
            >
              {googleBusy ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon size={20} />}
              Continue with Google
            </button>

            {/* Email via Magic's own dialog */}
            <button
              onClick={() => { if (magic) pick(magic); }}
              disabled={isPending || googleBusy || !magic}
              style={{
                width: "100%", padding: "14px", marginTop: 10,
                background: "#fff", color: "#111",
                border: "2px solid #111", borderRadius: 14,
                fontWeight: 800, fontSize: 14, cursor: isPending ? "wait" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {pendingId === "magic" ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
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
