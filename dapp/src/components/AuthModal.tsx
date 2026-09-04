"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { Connector } from "wagmi";
import { celo } from "viem/chains";
import { Mail, Wallet, X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

// Login sheet. We collect the email ourselves and hand it straight to Magic, so
// Magic only ever renders its OTP *code* screen — never its generic "Sign-in
// with Email" address step, which is off-brand and an extra click.
//
// Everything runs against the Magic instance the CONNECTOR owns. Spinning up a
// second Magic instance is what broke this flow before: two instances race over
// the same session and the connector ends up not seeing the login.
type MagicSdk = {
  auth?: {
    loginWithEmailOTP: (o: { email: string; showUI: boolean }) => Promise<unknown>;
  };
  oauth2?: {
    loginWithRedirect: (o: { provider: string; redirectURI: string }) => Promise<unknown>;
  };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Magic rejects with these when the user simply closes/cancels its OTP dialog —
// that's not an error worth shouting about.
function isUserCancel(e: unknown): boolean {
  const c = (e as { code?: string | number } | null)?.code;
  return c === -32603 || c === "MAGIC_LINK_FAILED_VERIFICATION" || c === 4001;
}

// Best-effort brand name for the injected provider, so the button reads
// "Connect Valora" / "Connect MiniPay" instead of a generic "Connect wallet".
function injectedWalletName(): string {
  if (typeof window === "undefined") return "your wallet";
  const eth = (window as { ethereum?: Record<string, unknown> }).ethereum;
  if (!eth) return "your wallet";
  if (eth.isValora) return "Valora";
  if (eth.isMiniPay) return "MiniPay";
  if (eth.isMetaMask) return "MetaMask";
  return "your wallet";
}

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
  const { connect, connectAsync, connectors, isPending } = useConnect();
  const { isConnected } = useAccount();

  const [view, setView] = useState<"main" | "wallets">("main");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");

  const magic = connectors.find((c) => c.id === "magic");
  const emailOk = EMAIL_RE.test(email.trim());
  const busy = isPending || googleBusy || emailBusy;

  // Wallet connectors = everything except Magic. EIP-6963 discovery adds named
  // wallets (id = rdns); prefer those and drop the generic `injected` fallback.
  const nonMagic = connectors.filter((c) => c.id !== "magic");
  const wc = nonMagic.find((c) => c.id === "walletConnect");
  // EIP-6963-discovered wallets carry rdns ids (io.metamask, …) — i.e. everything
  // that is neither our generic `injected` connector nor WalletConnect. These, plus
  // WalletConnect, are the STANDARD options and behave exactly as they did before —
  // no change for desktop-extension or plain-browser (non-Valora) users.
  const discovered = nonMagic.filter((c) => c.id !== "injected" && c.id !== "walletConnect");
  const injectedGeneric = nonMagic.find((c) => c.id === "injected");
  const hasInjectedProvider =
    typeof window !== "undefined" && typeof (window as { ethereum?: unknown }).ethereum !== "undefined";
  // Order the wallet sheet: Valora first, then MiniPay, then other wallets, with
  // WalletConnect last. Only reorders when those wallets are actually present, so a
  // user without Valora/MiniPay sees the same order as before.
  const walletRank = (c: Connector) => {
    const n = (c.name ?? "").toLowerCase();
    if (n.includes("valora")) return 0;
    if (n.includes("minipay") || n.includes("mini pay")) return 1;
    if (c.id === "walletConnect") return 9;
    return 5;
  };
  const walletConnectors: readonly Connector[] =
    [...discovered, ...(wc ? [wc] : [])].sort((a, b) => walletRank(a) - walletRank(b));

  // Valora / MiniPay expose a provider but (usually) NOT via EIP-6963, so they land
  // on the generic `injected` connector — which the old code dropped whenever
  // WalletConnect was configured, pushing those users onto the WalletConnect flow.
  // ONLY in that specific case (an injected wallet is present and no named wallet
  // was discovered) do we surface a one-tap native connect. Every other user hits
  // the unchanged path below.
  const injectedOnly: Connector | null =
    discovered.length === 0 && hasInjectedProvider && injectedGeneric ? injectedGeneric : null;

  useEffect(() => { if (open && isConnected) onClose(); }, [open, isConnected, onClose]);
  useEffect(() => {
    if (!open) {
      setView("main"); setPendingId(null); setErr("");
      setGoogleBusy(false); setEmailBusy(false); setEmail("");
    }
  }, [open]);
  useEffect(() => { if (!isPending) setPendingId(null); }, [isPending]);

  // Lift the sheet above the on-screen keyboard. On iOS / in-app wallet browsers
  // (Valora/MiniPay), a `position: fixed` sheet stays anchored to the FULL page
  // height — the keyboard doesn't shrink it — so the email field ends up behind the
  // keyboard with a bare gap. We keep the dark overlay covering the whole screen and
  // just pad its bottom by the keyboard's height (from visualViewport), which floats
  // the sheet right above the keyboard. Held in state so typing can't clobber it.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const vv = window.visualViewport;
    const apply = () => { if (vv) setKb(Math.max(0, window.innerHeight - vv.height - vv.offsetTop)); };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    // Stop the page behind from scrolling — on iOS that scroll drags the fixed sheet.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      document.body.style.overflow = prevOverflow;
      setKb(0);
    };
  }, [open]);

  if (!open) return null;

  function pick(c: Connector) {
    setPendingId(c.id);
    // Request Celo so external wallets are switched to the right chain on connect.
    connect({ connector: c, chainId: celo.id });
    // Hand the screen over to the wallet's OWN UI — WalletConnect's QR / deep-link
    // modal (e.g. into Valora), or an injected wallet's prompt. Closing our sheet is
    // what makes the hand-off clean: otherwise it sits on top of the WalletConnect
    // modal and the flow looks stuck (the bug testers hit). If the user cancels,
    // they land back on the page and can tap "Connect a wallet" again.
    onClose();
  }

  // Email sign-in. We already have the address, so `showUI: true` makes Magic
  // render only its code-entry step. It resolves once the code is verified; then
  // we hand the live session to wagmi, whose isAuthorized() short-circuits on
  // isLoggedIn() and connects without showing anything further.
  async function loginWithEmail() {
    if (!magic || busy || !emailOk) return;
    const sdk = (magic as unknown as { magic?: MagicSdk }).magic;
    if (!sdk?.auth?.loginWithEmailOTP) {
      setErr("Email sign-in is unavailable right now. Please use Google.");
      return;
    }
    setEmailBusy(true);
    setErr("");
    try {
      await sdk.auth.loginWithEmailOTP({ email: email.trim(), showUI: true });
      await connectAsync({ connector: magic, chainId: celo.id });
      onClose();
    } catch (e) {
      if (!isUserCancel(e)) {
        console.error("[auth] email sign-in failed", e);
        setErr("That didn't work. Check the code and try again.");
      }
    } finally {
      setEmailBusy(false);
    }
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
    if (!magic || busy) return;
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
        position: "fixed", inset: 0, zIndex: 2000, boxSizing: "border-box",
        paddingBottom: kb,
        background: "rgba(17,17,17,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        fontFamily: "'Space Grotesk', sans-serif",
        transition: "padding-bottom 0.12s ease-out",
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
          // Never taller than the visible area, and scroll inside if the keyboard
          // squeezes it — so the email field is always reachable above the keyboard.
          maxHeight: "100%", overflowY: "auto", boxSizing: "border-box",
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
              disabled={busy || !magic}
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

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0" }}>
              <span style={{ flex: 1, height: 1.5, background: "#e8e6e0" }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em" }}>or</span>
              <span style={{ flex: 1, height: 1.5, background: "#e8e6e0" }} />
            </div>

            {/* Email — collected here, so Magic only shows its code screen */}
            <form
              onSubmit={(e) => { e.preventDefault(); loginWithEmail(); }}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div style={{ position: "relative" }}>
                <Mail
                  size={17}
                  color="#aaa"
                  style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }}
                />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (err) setErr(""); }}
                  disabled={busy}
                  style={{
                    width: "100%", padding: "14px 14px 14px 40px",
                    background: "#fff", color: "#111",
                    border: "2px solid #111", borderRadius: 14,
                    fontWeight: 700, fontSize: 15, fontFamily: "inherit",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={busy || !emailOk || !magic}
                style={{
                  width: "100%", padding: "14px",
                  background: emailOk && !busy ? "#111" : "#e8e6e0",
                  color: emailOk && !busy ? "#fff" : "#aaa",
                  border: "2px solid", borderColor: emailOk && !busy ? "#111" : "#e8e6e0",
                  borderRadius: 14, fontWeight: 800, fontSize: 15,
                  cursor: emailOk && !busy ? "pointer" : "not-allowed",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "background .15s, color .15s, border-color .15s",
                }}
              >
                {emailBusy && <Loader2 size={16} className="animate-spin" />}
                {emailBusy ? "Check your email…" : "Continue with email"}
              </button>
            </form>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0" }}>
              <span style={{ flex: 1, height: 1.5, background: "#e8e6e0" }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em" }}>or</span>
              <span style={{ flex: 1, height: 1.5, background: "#e8e6e0" }} />
            </div>

            {injectedOnly ? (
              /* Valora / MiniPay in-app wallet: one-tap native connect, plus a
                 WalletConnect fallback link. This branch ONLY runs when an injected
                 wallet is present with no named wallet discovered — non-Valora users
                 never reach it and see the unchanged button below. */
              <>
                <button
                  onClick={() => pick(injectedOnly)}
                  disabled={busy}
                  style={{
                    width: "100%", padding: "14px",
                    background: "#fff", color: "#111",
                    border: "2px solid #111", borderRadius: 14,
                    fontWeight: 800, fontSize: 14, cursor: busy ? "wait" : "pointer",
                    fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <Wallet size={16} />
                  Connect {injectedWalletName()}
                </button>
                {wc && (
                  <button
                    onClick={() => pick(wc)}
                    disabled={busy}
                    style={{
                      width: "100%", padding: "8px", marginTop: 8,
                      background: "transparent", color: "#888", border: "none",
                      fontWeight: 700, fontSize: 12.5, cursor: busy ? "wait" : "pointer",
                      fontFamily: "inherit", textDecoration: "underline",
                    }}
                  >
                    Use a different wallet (WalletConnect)
                  </button>
                )}
              </>
            ) : (
              /* Unchanged path: desktop extensions (chooser), plain browser
                 (WalletConnect), or nothing (guidance). */
              <button
                onClick={() => {
                  if (walletConnectors.length === 0) {
                    setErr("No wallet found in this browser. Open GoodDrops inside your wallet app (Valora, MiniPay, MetaMask), or just use Google or email above — it creates a wallet for you automatically.");
                    return;
                  }
                  if (walletConnectors.length === 1) pick(walletConnectors[0]);
                  else setView("wallets");
                }}
                disabled={busy}
                style={{
                  width: "100%", padding: "14px",
                  background: "#fff", color: "#111",
                  border: "2px solid #111", borderRadius: 14,
                  fontWeight: 800, fontSize: 14, cursor: busy ? "wait" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Wallet size={16} />
                Connect a wallet
                {walletConnectors.length > 1 && <ChevronRight size={15} style={{ marginLeft: "auto" }} />}
              </button>
            )}

            <p style={{ margin: "16px 0 0", fontSize: 11, color: "#999", textAlign: "center", lineHeight: 1.5 }}>
              Google or email creates a secure wallet for you automatically. No seed phrase needed.
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
