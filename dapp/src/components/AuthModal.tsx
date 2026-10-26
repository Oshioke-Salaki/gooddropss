"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { Connector } from "wagmi";
import { celo } from "viem/chains";
import { Link2, Loader2, Mail } from "lucide-react";
import { isValoraBrowser } from "@/lib/valora";
import { PARTNER, PARTNER_CONNECTOR_ID, lastLogin, rememberLogin } from "@/lib/partner";
import { track } from "@/lib/analytics";
import { AuthSheet } from "@/components/auth/AuthSheet";
import { OptionRow } from "@/components/auth/OptionRow";
import { WalletSelectModal } from "@/components/auth/WalletSelectModal";

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

// Each block sits in its own hairline-separated band, matching the wallet modal.
const BAND = "p-6 border-b border-line";
const FIELD =
  // pl-13 = 52px, clearing the absolutely-positioned Mail icon (24px inset + 20px wide).
  // No backdrop-filter here: the fill is opaque so it blurred nothing, and it made the
  // input its own stacking context — which painted it over the icon sitting beside it.
  "w-full py-6 pl-13 pr-6 rounded-full bg-surface text-base/none text-heading " +
  "placeholder:text-nav-muted outline-none focus:ring-2 focus:ring-brand/30 " +
  "motion-safe:transition-shadow disabled:opacity-50";

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connectAsync, connectors, isPending, reset } = useConnect();
  const { isConnected } = useAccount();

  const [view, setView] = useState<"main" | "wallets" | "partner">("main");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");

  const magic = connectors.find((c) => c.id === "magic");
  // Present only when NEXT_PUBLIC_PARTNER_MAGIC_KEY is set (see lib/partner.ts).
  const partner = PARTNER ? connectors.find((c) => c.id === PARTNER_CONNECTOR_ID) : undefined;
  const emailOk = EMAIL_RE.test(email.trim());
  const busy = isPending || googleBusy || emailBusy || partnerBusy;

  // Wallet connectors = everything except the Magic ones. EIP-6963 discovery adds
  // named wallets (id = rdns); prefer those and drop the generic `injected` fallback.
  const nonMagic = connectors.filter((c) => c.id !== "magic" && c.id !== PARTNER_CONNECTOR_ID);
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
      setGoogleBusy(false); setEmailBusy(false); setPartnerBusy(false); setEmail("");
      return;
    }
    track("sign_in_opened");
    // A returning partner user lands on their own door, not a menu.
    if (PARTNER && lastLogin() === "partner") setView("partner");
  }, [open]);
  useEffect(() => { if (!isPending) setPendingId(null); }, [isPending]);
  // Clear any stuck connect state each time the sheet opens. Without this, a wallet
  // attempt that didn't finish (e.g. the user came back from Valora without pairing)
  // leaves `isPending` true, which greys out the connect button on the next open.
  useEffect(() => { if (open) reset(); }, [open, reset]);

  if (!open) return null;

  function pick(c: Connector) {
    setPendingId(c.id);
    // Request Celo so external wallets are switched to the right chain on connect.
    connect({ connector: c, chainId: celo.id }, { onSuccess: () => track("sign_in_completed", { method: "wallet" }) });
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
      track("sign_in_completed", { method: "email" });
      rememberLogin("gooddrops");
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
      rememberLogin("gooddrops");
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

  // Partner sign-in. Same shape as email sign-in, against the PARTNER connector's
  // own Magic instance — a different publishable key, so the OTP, the session and
  // the wallet all belong to the partner's app. The user gets the wallet they
  // already have there, verified status included; nothing is created or linked.
  async function loginWithPartner() {
    if (!partner || !PARTNER || busy || !emailOk) return;
    const sdk = (partner as unknown as { magic?: MagicSdk }).magic;
    if (!sdk?.auth?.loginWithEmailOTP) {
      setErr(`${PARTNER.name} sign-in is unavailable right now. Please use Google or email.`);
      return;
    }
    setPartnerBusy(true);
    setErr("");
    try {
      await sdk.auth.loginWithEmailOTP({ email: email.trim(), showUI: true });
      await connectAsync({ connector: partner, chainId: celo.id });
      track("sign_in_completed", { method: "partner" });
      rememberLogin("partner");
      onClose();
    } catch (e) {
      if (!isUserCancel(e)) {
        console.error("[auth] partner sign-in failed", e);
        setErr("That didn't work. Check the code and try again.");
      }
    } finally {
      setPartnerBusy(false);
    }
  }

  // Valora's in-app browser injects no provider, so we pair over WalletConnect and
  // deep-link into it — the label says so plainly rather than "Connect a wallet".
  const walletLabel = isValoraBrowser() ? "Connect with Valora" : "Connect a wallet";

  function openWallets() {
    if (walletConnectors.length === 0) {
      setErr("No wallet found in this browser. Open GoodDrops inside your wallet app (Valora, MiniPay, MetaMask), or just use Google or email above — it creates a wallet for you automatically.");
      return;
    }
    if (walletConnectors.length === 1) pick(walletConnectors[0]);
    else setView("wallets");
  }

  return (
    <AuthSheet
      title={
        view === "wallets" ? "Choose a wallet"
        : view === "partner" && PARTNER ? `Continue with ${PARTNER.name}`
        : "Sign in to GoodDrops"
      }
      onBack={view !== "main" ? () => { setView("main"); setErr(""); } : undefined}
      onClose={onClose}
      dismissible={!busy}
    >
      {view === "wallets" ? (
        <WalletSelectModal
          connectors={walletConnectors}
          pendingId={pendingId}
          busy={busy}
          onPick={pick}
        />
      ) : view === "partner" && PARTNER && partner ? (
        <>
          <p className="text-sm/[150%] text-nav-muted px-6 mt-6">
            Use the email you signed up to {PARTNER.name} with. You&rsquo;ll get the same
            wallet here — already verified, G$ and all.
          </p>

          {err && (
            <p className="mx-6 mt-4 rounded-2xl bg-[#FFF1F1] px-4 py-3 text-sm leading-relaxed text-[#C81E1E]">
              {err}
            </p>
          )}

          <form
            onSubmit={(e) => { e.preventDefault(); loginWithPartner(); }}
            className={`${BAND} space-y-2.5`}
          >
            <div className="relative">
              <Mail className="absolute left-6 top-1/2 -translate-y-1/2 z-10 w-5 h-5 text-black pointer-events-none" />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={`Your ${PARTNER.name} email`}
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (err) setErr(""); }}
                disabled={busy}
                autoFocus
                className={FIELD}
              />
            </div>
            <button
              type="submit"
              disabled={busy || !emailOk}
              className={`w-full py-6 rounded-full text-white text-base/none flex items-center justify-center gap-2
                motion-safe:transition-colors
                ${emailOk && !busy ? "bg-nav-active cursor-pointer" : "bg-[#1B1B1B66] cursor-not-allowed"}`}
            >
              {partnerBusy && <Loader2 className="w-4 h-4 animate-spin" />}
              {partnerBusy ? "Check your email…" : `Continue with ${PARTNER.name}`}
            </button>
          </form>

          <p className="px-6 text-xs text-nav-muted leading-relaxed">
            We&rsquo;ll email you a one-time code from {PARTNER.name}. No new wallet is
            created and nothing is linked — it&rsquo;s your existing account, used here.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm/none text-nav-muted px-6 mt-6">
            Hide and hunt real G$ anywhere in the world.
          </p>

          {err && (
            <p className="mx-6 mt-4 rounded-2xl bg-[#FFF1F1] px-4 py-3 text-sm leading-relaxed text-[#C81E1E]">
              {err}
            </p>
          )}

          {/* Google — primary path: no OTP email, so no spam-folder risk */}
          <div className={BAND}>
            <OptionRow
              label="Continue with Google"
              iconSrc="/google-logo.svg"
              onClick={loginWithGoogle}
              disabled={busy || !magic}
              busy={googleBusy}
            />
          </div>

          {/* Email — collected here, so Magic only shows its code screen */}
          <form
            onSubmit={(e) => { e.preventDefault(); loginWithEmail(); }}
            className={`${BAND} space-y-2.5`}
          >
            <div className="relative">
              <Mail className="absolute left-6 top-1/2 -translate-y-1/2 z-10 w-5 h-5 text-black pointer-events-none" />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Your email address"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (err) setErr(""); }}
                disabled={busy}
                className={FIELD}
              />
            </div>
            <button
              type="submit"
              disabled={busy || !emailOk || !magic}
              className={`w-full py-6 rounded-full text-white text-base/none flex items-center justify-center gap-2
                motion-safe:transition-colors
                ${emailOk && !busy && magic ? "bg-nav-active cursor-pointer" : "bg-[#1B1B1B66] cursor-not-allowed"}`}
            >
              {emailBusy && <Loader2 className="w-4 h-4 animate-spin" />}
              {emailBusy ? "Check your email…" : "Continue with email"}
            </button>
          </form>

          {/* Partner door — only rendered once the partner's key is configured. */}
          {PARTNER && partner && (
            <div className={BAND}>
              <OptionRow
                label={`Continue with ${PARTNER.name}`}
                iconSrc={PARTNER.logo || undefined}
                iconFallback={<Link2 className="w-5 h-5 text-heading" />}
                onClick={() => { setErr(""); setView("partner"); }}
                disabled={busy}
              />
            </div>
          )}

          <div className="p-6">
            {injectedOnly ? (
              /* Valora / MiniPay in-app wallet: one-tap native connect, plus a
                 WalletConnect fallback link. This branch ONLY runs when an injected
                 wallet is present with no named wallet discovered — non-Valora users
                 never reach it and see the unchanged button below. */
              <>
                <OptionRow
                  label={`Connect ${injectedWalletName()}`}
                  iconSrc="/wallet-logo.svg"
                  onClick={() => pick(injectedOnly)}
                  disabled={busy}
                  busy={pendingId === injectedOnly.id}
                />
                {wc && (
                  <button
                    type="button"
                    onClick={() => pick(wc)}
                    disabled={busy}
                    className="w-full mt-3 text-xs/none text-nav-muted underline underline-offset-4 cursor-pointer disabled:cursor-wait disabled:opacity-50 motion-safe:transition-colors hover:text-heading"
                  >
                    Use a different wallet (WalletConnect)
                  </button>
                )}
              </>
            ) : (
              /* Unchanged path: desktop extensions (chooser), plain browser
                 (WalletConnect), or nothing (guidance). */
              <OptionRow
                label={walletLabel}
                iconSrc="/wallet-logo.svg"
                onClick={openWallets}
                disabled={busy}
              />
            )}
          </div>

          <p className="px-6 text-xs text-nav-muted leading-relaxed">
            Google or email creates a secure wallet for you automatically. No
            seed phrase needed.
          </p>
        </>
      )}
    </AuthSheet>
  );
}

export default AuthModal;
