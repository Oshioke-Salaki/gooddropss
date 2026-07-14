"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import { isAddress, getAddress, type EIP1193Provider } from "viem";
import {
  Mail, Wallet, ShieldCheck, ArrowRight, Loader2, Check, AlertCircle, ClipboardPaste, Coins,
  Copy, Fuel, X, BadgeCheck,
} from "lucide-react";
import {
  loginWeb3Auth, openWeb3AuthModal, prepareWeb3Auth, logoutWeb3Auth, PopupBlockedError,
} from "@/lib/web3auth";
import { NONE, type IdentityStatus } from "@/lib/identity";
import {
  walletClientFromProvider, identityStatus, generateReverifyLink, rootOf, linkNewWallet, sweepGDollar, gDollarBalance,
  celoBalance,
} from "@/lib/identityLink";

const GOODDROPS_URL = "https://gooddrops.xyz";
// Below this the old wallet almost certainly can't cover gas for the link tx.
const GAS_MIN_WEI = 8_000_000_000_000_000n; // 0.008 CELO
const ZERO = "0x0000000000000000000000000000000000000000";

type Step =
  | "email" | "connectOld" | "checkingWallet" | "reverify" | "pasteMagic"
  | "working" | "done" | "notfound" | "nothingToDo" | "error";
type AuthType = "privy" | "web3auth" | "";
// link   = verified now → connectAccount + sweep
// rescue = never verified → sweep only, no identity exists
// (a LAPSED wallet gets the dedicated "reverify" step: it has an identity, but
//  connectAccount is onlyWhitelisted so it cannot link until it re-verifies)
type Mode = "link" | "rescue";

function fmtG$(wei: bigint): string {
  const n = Number(wei) / 1e18;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}
function short(a: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ""; }

export function MigrateFlow() {
  const { login: privyLogin, authenticated: privyAuthed, logout: privyLogout } = usePrivy();
  const { wallets } = useWallets();

  const [step, setStep]       = useState<Step>("email");
  const [email, setEmail]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState("");
  const [workMsg, setWorkMsg] = useState("");

  const [authType, setAuthType]   = useState<AuthType>("");
  const [oldHint, setOldHint]     = useState<string | null>(null);
  const [oldAddress, setOldAddr]  = useState("");
  const [mode, setMode]           = useState<Mode>("link");
  const [oldBalance, setOldBal]   = useState<bigint>(0n);
  const [magicInput, setMagicIn]  = useState("");
  const [swept, setSwept]         = useState<bigint | null>(null);
  const [sweepEnabled, setSweep]  = useState(true); // move G$ by default (verified users can opt out)
  const [privyPending, setPrivyPending] = useState(false);
  const [celoBal, setCeloBal]     = useState<bigint>(0n);
  const [addrOpen, setAddrOpen]   = useState(false);   // copy-address modal
  const [copied, setCopied]       = useState(false);
  const [verifiedRoot, setVerifiedRoot] = useState<string | null>(null); // recipient already verified
  const [preChecking, setPreChecking]   = useState(false);
  const [identity, setIdentity]   = useState<IdentityStatus>(NONE);
  const [fvBusy, setFvBusy]       = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const oldProviderRef  = useRef<EIP1193Provider | null>(null);
  const privyHandledRef = useRef(false);
  const lowGas = oldAddress !== "" && celoBal < GAS_MIN_WEI;

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const magicValid = isAddress(magicInput.trim());
  const magicSameAsOld = magicValid && !!oldAddress &&
    magicInput.trim().toLowerCase() === oldAddress.toLowerCase();

  // ── Step 1: email → detect legacy account ──────────────────────────────────
  const handleEmail = useCallback(async () => {
    setErr("");
    if (!emailValid) return;
    setBusy(true);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      // A failed lookup (server/DB error) must NOT masquerade as "no account
      // found" — that would wrongly tell real users they aren't in our records.
      if (!res.ok) {
        setErr(data.error ?? "Couldn't reach our records. Please try again.");
        return;
      }
      if (!data.found || !data.migratable) { setStep("notfound"); return; }
      setAuthType(data.authType as AuthType);
      setOldHint(data.wallet ?? null);
      privyHandledRef.current = false;
      setStep("connectOld");
    } catch {
      setErr("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [email, emailValid]);

  // ── Step 2: after OLD wallet login → decide link vs rescue ─────────────────
  const afterOldLogin = useCallback(async (provider: EIP1193Provider, address: string) => {
    oldProviderRef.current = provider;
    setOldAddr(address.toLowerCase());
    setStep("checkingWallet");
    setErr("");
    try {
      const [id, balance, celo] = await Promise.all([
        identityStatus(address),
        gDollarBalance(address),
        celoBalance(address),
      ]);
      setOldBal(balance);
      setCeloBal(celo);
      setIdentity(id);

      if (id.state === "verified") {
        setMode("link");
        setStep("pasteMagic");
        // No gas → surface the copy-address modal so they can request CELO.
        if (celo < GAS_MIN_WEI) setAddrOpen(true);
      } else if (id.state === "lapsed") {
        // They ARE face-verified — their whitelist just ran out (GoodDollar only
        // gives first-time verifiers 3 days). connectAccount is onlyWhitelisted,
        // so linking is impossible until they re-verify THIS wallet. Sending them
        // to "rescue" would sweep the G$ and abandon a real, recoverable identity.
        setStep("reverify");
      } else if (balance > 0n) {
        setMode("rescue");
        setStep("pasteMagic");
        if (celo < GAS_MIN_WEI) setAddrOpen(true);
      } else {
        setStep("nothingToDo");
      }
    } catch {
      setErr("Couldn't read your wallet on-chain. Please try again.");
      setStep("error");
    }
  }, []);

  // Re-check after the user returns from GoodDollar's face verification.
  const recheckIdentity = useCallback(async () => {
    if (!oldAddress) return;
    setRechecking(true);
    setErr("");
    try {
      const id = await identityStatus(oldAddress);
      setIdentity(id);
      if (id.state === "verified") {
        setMode("link");
        setStep("pasteMagic");
        if (celoBal < GAS_MIN_WEI) setAddrOpen(true);
      } else {
        setErr("Not verified yet — GoodDollar can take a minute to confirm. Try again shortly.");
      }
    } catch {
      setErr("Couldn't check your verification. Please try again.");
    } finally {
      setRechecking(false);
    }
  }, [oldAddress, celoBal]);

  // Open GoodDollar's face-verification for the OLD wallet. It must be signed by
  // that wallet — verifying the new one would mint a second identity instead of
  // reviving this one.
  const startReverify = useCallback(async () => {
    const provider = oldProviderRef.current;
    if (!provider || !oldAddress) return;
    setFvBusy(true);
    setErr("");
    try {
      const client = await walletClientFromProvider(provider, oldAddress);
      const link = await generateReverifyLink(client, oldAddress, window.location.href);
      window.open(link, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr((e as Error).message || "Couldn't open GoodDollar verification.");
    } finally {
      setFvBusy(false);
    }
  }, [oldAddress]);

  // Auto-continue once Privy finishes login and a wallet is available. Covers
  // both the email→Privy path and the "connect a wallet" path (Privy's modal
  // handles external wallets — MetaMask, WalletConnect, etc. — natively).
  useEffect(() => {
    if (!privyPending || !privyAuthed || wallets.length === 0 || privyHandledRef.current) return;
    privyHandledRef.current = true;
    // Prefer the wallet matching the looked-up address; otherwise the first
    // connected wallet (the one the user just picked).
    const wallet =
      (oldHint && wallets.find((w) => w.address.toLowerCase() === oldHint)) || wallets[0];
    (async () => {
      try {
        await wallet.switchChain(42220);
        const provider = (await wallet.getEthereumProvider()) as unknown as EIP1193Provider;
        await afterOldLogin(provider, wallet.address.toLowerCase());
      } catch (e) {
        setErr((e as Error).message || "Couldn't open your wallet.");
      } finally {
        setPrivyPending(false);
      }
    })();
  }, [privyPending, privyAuthed, wallets, oldHint, afterOldLogin]);

  const startPrivy = useCallback((walletOnly: boolean) => {
    setErr("");
    privyHandledRef.current = false;
    setPrivyPending(true);
    // If already authenticated, the effect proceeds; otherwise open Privy's modal.
    if (!privyAuthed) {
      if (walletOnly) privyLogin({ loginMethods: ["wallet"] });
      else privyLogin();
    }
  }, [privyAuthed, privyLogin]);

  const connectPrivy  = useCallback(() => startPrivy(false), [startPrivy]);
  const connectWallet = useCallback(() => startPrivy(true), [startPrivy]);

  // Load + init the Web3Auth SDK the moment we know we'll need it. This MUST
  // happen before the click: connectTo() opens a popup, and any `await` in front
  // of it (like init) ends the user gesture and gets the popup blocked — which
  // shows up as a spinner that never resolves.
  useEffect(() => {
    if (step === "connectOld" && authType === "web3auth") {
      prepareWeb3Auth().catch(() => { /* click falls back to the modal */ });
    }
  }, [step, authType]);

  const connectWeb3Auth = useCallback(async () => {
    setErr("");
    setPopupBlocked(false);
    setBusy(true);
    try {
      // No await before this call — the popup has to open inside the click.
      // The email from step 1 is passed as loginHint so Web3Auth skips its own
      // modal instead of asking for the same address a second time.
      const { provider, address } = await loginWeb3Auth(email.trim());
      await afterOldLogin(provider, address);
    } catch (e) {
      if (e instanceof PopupBlockedError) {
        setPopupBlocked(true);
        setErr(e.message);
      } else {
        setErr((e as Error).message || "Couldn't connect your Web3Auth wallet.");
      }
    } finally {
      setBusy(false);
    }
  }, [afterOldLogin, email]);

  // Escape hatch when a popup blocker eats the headless window. The modal opens
  // its popup from its own click, so it always gets through.
  const connectWeb3AuthModal = useCallback(async () => {
    setErr("");
    setBusy(true);
    try {
      const { provider, address } = await openWeb3AuthModal();
      await afterOldLogin(provider, address);
    } catch (e) {
      setErr((e as Error).message || "Couldn't connect your Web3Auth wallet.");
    } finally {
      setBusy(false);
    }
  }, [afterOldLogin]);

  // Shared error mapping for on-chain failures.
  const toFriendlyError = (e: unknown) => {
    const msg = (e as Error).message || "";
    return /insufficient|gas|funds/i.test(msg)
      ? "Your old wallet needs a tiny amount of CELO for gas. Copy your address, send a little CELO, and try again."
      : msg || "Something went wrong. Please try again.";
  };

  // Move G$ from old → new wallet, no identity linking.
  const runSweepOnly = useCallback(async (magic: string) => {
    const provider = oldProviderRef.current;
    if (!provider) return;
    setVerifiedRoot(null);
    setStep("working");
    setBusy(true);
    setErr("");
    try {
      const oldClient = await walletClientFromProvider(provider, oldAddress);
      setWorkMsg("Moving your G$ to your new wallet…");
      const bal = await gDollarBalance(oldAddress);
      if (bal > 0n) {
        const { swept: moved } = await sweepGDollar(oldClient, oldAddress, magic);
        setSwept(moved);
      } else setSwept(0n);
      setMode("rescue"); // success screen shows the "G$ moved" variant
      setStep("done");
    } catch (e) {
      setErr(toFriendlyError(e));
      setStep("error");
    } finally {
      setBusy(false);
    }
  }, [oldAddress]);

  // Link the identity (link mode) then sweep G$ per the toggle.
  const runLinkAndSweep = useCallback(async (magic: string) => {
    const provider = oldProviderRef.current;
    if (!provider) return;
    setStep("working");
    setBusy(true);
    setErr("");
    try {
      const oldClient = await walletClientFromProvider(provider, oldAddress);

      if (mode === "link") {
        setWorkMsg("Linking your verified identity to your new wallet…");
        await linkNewWallet(oldClient, oldAddress, magic);
        setWorkMsg("Confirming the link on-chain…");
        if ((await rootOf(magic)) === ZERO) {
          throw new Error("The link didn't confirm on-chain. Please try again.");
        }
      }

      if (mode === "rescue" || sweepEnabled) {
        setWorkMsg("Moving your G$ to your new wallet…");
        const bal = await gDollarBalance(oldAddress);
        if (bal > 0n) {
          const { swept: moved } = await sweepGDollar(oldClient, oldAddress, magic);
          setSwept(moved);
        } else setSwept(0n);
      } else {
        setSwept(null); // user opted to leave G$ in the old wallet
      }

      setStep("done");
    } catch (e) {
      setErr(toFriendlyError(e));
      setStep("error");
    } finally {
      setBusy(false);
    }
  }, [oldAddress, mode, sweepEnabled]);

  // ── Step 3: submit → check recipient, then link/sweep ──────────────────────
  const onSubmit = useCallback(async () => {
    const provider = oldProviderRef.current;
    if (!provider) { setErr("Your old wallet session was lost. Please start over."); return; }
    const magic = magicInput.trim();
    if (!isAddress(magic)) { setErr("That doesn't look like a valid wallet address."); return; }
    if (magic.toLowerCase() === oldAddress.toLowerCase()) {
      setErr("That's your old wallet. Paste your NEW GoodDrops wallet address.");
      return;
    }

    // Rescue mode is a pure sweep — no linking, no recipient check needed.
    if (mode === "rescue") { runSweepOnly(magic); return; }

    // Link mode: if the recipient is already verified/linked, there's nothing to
    // link — surface a modal (with a "send G$ instead" option).
    setErr("");
    setPreChecking(true);
    try {
      const existingRoot = await rootOf(magic);
      if (existingRoot !== ZERO) {
        setVerifiedRoot(existingRoot);
        return;
      }
      await runLinkAndSweep(magic);
    } catch (e) {
      setErr(toFriendlyError(e));
    } finally {
      setPreChecking(false);
    }
  }, [magicInput, oldAddress, mode, runSweepOnly, runLinkAndSweep]);

  // "Start over" is a real SIGN-OUT, not just a form reset.
  //
  // This app handles other people's verified identities and their G$. If a shared
  // or public device kept the old wallet's session alive after "start over", the
  // next person to touch it could link THEIR wallet to the previous user's
  // identity and sweep their balance. So: end the Privy session, end the Web3Auth
  // session, drop the cached EIP-1193 provider, and clear every trace of the
  // previous user from the page — including the email.
  const [signingOut, setSigningOut] = useState(false);

  const reset = useCallback(async () => {
    setSigningOut(true);
    try {
      await Promise.allSettled([
        privyLogout(),
        logoutWeb3Auth(),
      ]);
    } finally {
      setStep("email"); setErr(""); setBusy(false); setAuthType("");
      setEmail("");                 // don't leave the last user's address in the field
      setOldAddr(""); setOldHint(null); setMagicIn(""); setSwept(null); setWorkMsg("");
      setMode("link"); setOldBal(0n); setSweep(true); setPrivyPending(false);
      setCeloBal(0n); setAddrOpen(false); setCopied(false);
      setVerifiedRoot(null); setPreChecking(false);
      setIdentity(NONE); setFvBusy(false); setRechecking(false);
      oldProviderRef.current = null;
      privyHandledRef.current = false;
      setSigningOut(false);
    }
  }, [privyLogout]);

  function copyOldAddress() {
    navigator.clipboard?.writeText(getAddress(oldAddress)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const ctaReady = magicValid && !magicSameAsOld;

  return (
    <div style={{ width: "100%", maxWidth: 440 }}>
      {/* Top-right connected-wallet pill — copy address to request gas */}
      {oldAddress && (
        <button
          onClick={() => setAddrOpen(true)}
          style={{
            position: "fixed", top: 16, right: 16, zIndex: 90,
            display: "flex", alignItems: "center", gap: 8,
            background: "#fff", border: "2px solid #111", borderRadius: 100,
            boxShadow: "2px 2px 0 #111", padding: "7px 12px 7px 14px",
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 13,
            color: "#111", cursor: "pointer",
          }}
          title="Copy your wallet address"
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{short(oldAddress)}</span>
          <Copy size={14} color="#888" />
        </button>
      )}

      <AnimatePresence mode="wait">
        {/* STEP: email */}
        {step === "email" && (
          <motion.div key="email" className="rise" style={card}>
            <Badge icon={<ShieldCheck size={13} />}>Welcome back</Badge>
            <h1 style={h1}>Bring your verified account to GoodDrops</h1>
            <p style={sub}>
              You already face-verified with GoodDollar. Link it to your new GoodDrops wallet
              in under 2 minutes — no re-verification.
            </p>
            <label style={fieldLabel}>Your email</label>
            <div style={{ position: "relative" }}>
              <Mail size={18} style={inputIcon} />
              <input
                type="email" value={email} autoFocus disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && emailValid && !busy && handleEmail()}
                placeholder="you@email.com" style={input}
              />
            </div>
            {err && <ErrorLine>{err}</ErrorLine>}
            <button onClick={handleEmail} disabled={!emailValid || busy} style={btn(emailValid && !busy)}>
              {busy ? <><Loader2 size={18} className="spin" /> Checking your account…</>
                    : <>Continue <ArrowRight size={18} /></>}
            </button>

            {/* Alternative: skip the email lookup and connect the verified wallet
                directly via Privy's wallet modal (MetaMask, WalletConnect, …). */}
            <div style={dividerRow}><span style={dividerLine} /><span style={dividerText}>or</span><span style={dividerLine} /></div>
            {/* Not disabled on privyPending: if the user cancels Privy's modal we
                must let them click again (otherwise the button stays stuck). */}
            <button onClick={connectWallet} disabled={busy} style={secondaryBtn}>
              {privyPending ? <Loader2 size={16} className="spin" /> : <Wallet size={16} />}
              Connect a wallet instead
            </button>

            <p style={fine}>Use the same email from your previous app, or connect the wallet you verified with.</p>
          </motion.div>
        )}

        {/* STEP: connect old wallet */}
        {step === "connectOld" && (
          <motion.div key="connect" className="rise" style={card}>
            <Badge icon={<Wallet size={13} />}>Step 1 of 2</Badge>
            <h1 style={h1}>Sign in to your old wallet</h1>
            <p style={sub}>
              We found your account. Sign in with your{" "}
              <b>{authType === "privy" ? "email wallet" : "Web3Auth account"}</b> so it can
              authorize the link.
            </p>
            {oldHint && (
              <div style={hintBox}>
                <Wallet size={15} />
                <span>Your wallet <Mono>{short(oldHint)}</Mono></span>
              </div>
            )}
            {err && <ErrorLine>{err}</ErrorLine>}
            {authType === "privy" ? (
              <button onClick={connectPrivy} style={btn(true)}>
                <Mail size={18} /> {privyAuthed ? "Continue" : "Sign in with email"}
              </button>
            ) : (
              <>
                <button onClick={connectWeb3Auth} disabled={busy} style={btn(!busy)}>
                  {busy ? <Loader2 size={18} className="spin" /> : <Wallet size={18} />}
                  {busy ? "Opening…" : "Sign in with Web3Auth"}
                </button>
                {popupBlocked && (
                  <button onClick={connectWeb3AuthModal} disabled={busy} style={{ ...secondaryBtn, marginTop: 10 }}>
                    <Wallet size={16} /> Open the Web3Auth window instead
                  </button>
                )}
              </>
            )}
            <button onClick={reset} disabled={signingOut} style={ghostBtn}>{signingOut ? "Signing out…" : "Use a different email"}</button>
          </motion.div>
        )}

        {/* STEP: checking wallet on-chain */}
        {step === "checkingWallet" && (
          <motion.div key="checking" className="rise" style={card}>
            <Working title="Checking your wallet" msg="Reading your GoodDollar verification and G$ balance…" />
          </motion.div>
        )}

        {/* STEP: lapsed verification — must re-verify BEFORE linking.
            connectAccount() is onlyWhitelisted, so this is a hard gate, not a
            nicety. The old copy ("not verified, here's a rescue") would have had
            these users sweep their G$ and walk away from a real identity. */}
        {step === "reverify" && (
          <motion.div key="reverify" className="rise" style={card}>
            <Badge icon={<ShieldCheck size={13} />}>One quick step</Badge>

            <div style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              background: "#FFF4E0", border: "2px solid #FFB020",
              borderRadius: 14, padding: "12px 14px", marginTop: 14,
            }}>
              <BadgeCheck size={18} style={{ flexShrink: 0, marginTop: 1, color: "#8a6500" }} />
              <span style={{ fontSize: 13, lineHeight: 1.55, color: "#7a5a00", textAlign: "left" }}>
                <b>Good news — you are face-verified.</b> GoodDollar only keeps a
                first-time verification active for <b>3 days</b>, and yours has since
                lapsed. Re-verify once and it lasts <b>6 months</b>.
              </span>
            </div>

            <h1 style={{ ...h1, marginTop: 16 }}>Re-verify to keep your identity</h1>
            <p style={sub}>
              Your identity lives on <Mono>{short(oldAddress)}</Mono>, so it has to be
              this wallet that re-verifies — that&apos;s what lets us move it to your new one.
              {oldBalance > 0n && <> Your <b>{fmtG$(oldBalance)} G$</b> is safe and comes with it.</>}
            </p>

            <ol style={{
              margin: "14px 0 0", padding: "14px 16px 14px 32px",
              background: "#F3FFD1", border: "2px solid #BFFD00", borderRadius: 14,
              fontSize: 13, lineHeight: 1.7, textAlign: "left", color: "#111",
            }}>
              <li>Tap <b>Re-verify with GoodDollar</b> (opens in a new tab).</li>
              <li>Complete the quick face check.</li>
              <li>Come back here and tap <b>I&apos;ve re-verified</b>.</li>
            </ol>

            {err && <ErrorLine>{err}</ErrorLine>}

            <button
              onClick={startReverify}
              disabled={fvBusy}
              style={{ ...btn(!fvBusy), marginTop: 14 }}
            >
              {fvBusy
                ? <><Loader2 size={17} className="spin" /> Opening…</>
                : <><ShieldCheck size={17} /> Re-verify with GoodDollar</>}
            </button>

            <button
              onClick={recheckIdentity}
              disabled={rechecking}
              style={{ ...secondaryBtn, marginTop: 10, boxShadow: "2px 2px 0 #111", cursor: rechecking ? "wait" : "pointer" }}
            >
              {rechecking
                ? <><Loader2 size={16} className="spin" /> Checking…</>
                : <><Check size={16} /> I&apos;ve re-verified — continue</>}
            </button>

            {/* Escape hatch. Deliberately understated and honest about the cost —
                sweeping abandons a recoverable identity, so it must not look like
                the easy default. */}
            {oldBalance > 0n && (
              <button
                onClick={() => { setMode("rescue"); setStep("pasteMagic"); setErr(""); }}
                style={{ ...ghostBtn, marginTop: 12 }}
              >
                Skip — just move my {fmtG$(oldBalance)} G$ (identity stays behind)
              </button>
            )}

            <button onClick={reset} disabled={signingOut} style={ghostBtn}>{signingOut ? "Signing out…" : "Sign out & start over"}</button>
          </motion.div>
        )}

        {/* STEP: paste new wallet */}
        {step === "pasteMagic" && (
          <motion.div key="paste" className="rise" style={card}>
            <Badge icon={<ClipboardPaste size={13} />}>Step 2 of 2</Badge>
            {mode === "link" ? (
              <>
                <h1 style={h1}>Paste your new GoodDrops wallet</h1>
                <p style={sub}>
                  Wallet <Mono>{short(oldAddress)}</Mono> is verified ✓
                  {oldBalance > 0n && <> and holds <b>{fmtG$(oldBalance)} G$</b></>}.
                  Paste your new GoodDrops wallet — we&apos;ll link your identity to it
                  {oldBalance > 0n ? " and move your G$ over" : ""}.
                </p>
              </>
            ) : (
              <>
                <div style={rescueBox}>
                  <Coins size={18} style={{ flexShrink: 0 }} />
                  <span>
                    {identity.state === "lapsed" ? (
                      // They got here by explicitly skipping the re-verify step. Do
                      // NOT tell them they have no identity — they do, and it stays
                      // recoverable. Say exactly what they're giving up, and that
                      // they can come back.
                      <>
                        Moving your <b>{fmtG$(oldBalance)} G$</b> only. Your verified identity
                        stays on <Mono>{short(oldAddress)}</Mono> — re-verify any time to link it
                        to your new wallet.
                      </>
                    ) : (
                      <>
                        This wallet has never been GoodDollar-verified, so there&apos;s no identity
                        to link — but it holds <b>{fmtG$(oldBalance)} G$</b>. Paste your new wallet
                        to move your G$ out.
                      </>
                    )}
                  </span>
                </div>
                <h1 style={{ ...h1, marginTop: 16 }}>Rescue your G$</h1>
                <p style={sub}>Enter the wallet you want your <b>{fmtG$(oldBalance)} G$</b> sent to.</p>
                {identity.state === "lapsed" && (
                  <button
                    onClick={() => { setStep("reverify"); setErr(""); }}
                    style={{ ...secondaryBtn, marginBottom: 4 }}
                  >
                    <ShieldCheck size={16} /> Actually — re-verify and keep my identity
                  </button>
                )}
              </>
            )}
            <div style={howBox}>
              <b>Where to find it:</b> open GoodDrops → tap your wallet → <b>Copy address</b>.
            </div>

            {/* Low-gas warning — the old wallet needs CELO to sign the link tx */}
            {lowGas && (
              <button type="button" onClick={() => setAddrOpen(true)} style={gasWarn}>
                <Fuel size={16} style={{ flexShrink: 0 }} />
                <span style={{ textAlign: "left", lineHeight: 1.4 }}>
                  <b>Your old wallet is low on CELO for gas.</b> Tap to copy its address and send a little CELO.
                </span>
              </button>
            )}

            <label style={fieldLabel}>New wallet address</label>
            <div style={{ position: "relative" }}>
              <Wallet size={18} style={inputIcon} />
              <input
                value={magicInput}
                onChange={(e) => setMagicIn(e.target.value)}
                placeholder="0x…" spellCheck={false}
                style={{
                  ...input, fontFamily: "ui-monospace, monospace", fontSize: 14,
                  borderColor: magicInput && !magicValid ? "#FF3B3B" : ctaReady ? "#22c55e" : "#111",
                }}
              />
              {ctaReady && (
                <Check size={18} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#22c55e" }} />
              )}
            </div>
            {ctaReady && (
              <p style={{ ...fine, textAlign: "left", margin: "6px 0 0", color: "#16a34a" }}>
                Sending to {getAddress(magicInput.trim())}
              </p>
            )}
            {magicSameAsOld && <ErrorLine>That&apos;s your old wallet — paste your NEW one.</ErrorLine>}
            {err && <ErrorLine>{err}</ErrorLine>}

            {/* Optional G$ sweep — verified users can leave their G$ in the old wallet */}
            {mode === "link" && oldBalance > 0n && (
              <button
                type="button"
                onClick={() => setSweep((v) => !v)}
                style={{
                  ...toggleRow,
                  borderColor: sweepEnabled ? "#111" : "#ddd",
                  background: sweepEnabled ? "#F0FDE8" : "#fff",
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  border: "2px solid #111", background: sweepEnabled ? "#BFFD00" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {sweepEnabled && <Check size={14} color="#111" strokeWidth={3.5} />}
                </span>
                <span style={{ textAlign: "left", lineHeight: 1.35 }}>
                  <b style={{ fontSize: 13.5 }}>Also move my {fmtG$(oldBalance)} G$</b>
                  <span style={{ display: "block", fontSize: 11.5, color: "#888" }}>
                    {sweepEnabled ? "Recommended — sends your G$ to the new wallet" : "Your G$ will stay in your old wallet"}
                  </span>
                </span>
              </button>
            )}

            <button onClick={onSubmit} disabled={!ctaReady || preChecking} style={btn(ctaReady && !preChecking)}>
              {preChecking ? <><Loader2 size={18} className="spin" /> Checking…</>
                : <>{mode === "rescue"
                    ? "Move my G$ out"
                    : sweepEnabled && oldBalance > 0n
                      ? "Link & move my G$"
                      : "Link my account"} <ArrowRight size={18} /></>}
            </button>
            <button onClick={reset} disabled={signingOut} style={ghostBtn}>{signingOut ? "Signing out…" : "Sign out & start over"}</button>
          </motion.div>
        )}

        {/* STEP: working */}
        {step === "working" && (
          <motion.div key="working" className="rise" style={card}>
            <Working title={mode === "link" ? "Restoring your account" : "Moving your G$"} msg={workMsg} />
            <p style={fine}>Approve any prompts from your old wallet. This can take a moment.</p>
          </motion.div>
        )}

        {/* STEP: done */}
        {step === "done" && (
          <motion.div key="done" className="rise" style={{ ...card, textAlign: "center" }}>
            <div className="pop" style={successCircle}><Check size={40} color="#111" strokeWidth={3} /></div>
            <h1 style={{ ...h1, textAlign: "center" }}>
              {mode === "link" ? "You're all set! 🎉" : "G$ moved! 🎉"}
            </h1>
            <p style={{ ...sub, textAlign: "center" }}>
              {mode === "link" ? (
                <>Your verified GoodDollar identity now lives on your new wallet <Mono>{short(magicInput.trim())}</Mono>.</>
              ) : (
                <>Your G$ is now in <Mono>{short(magicInput.trim())}</Mono>.</>
              )}
              {swept !== null && swept > 0n && <> We moved <b>{fmtG$(swept)} G$</b> across.</>}
              {mode === "link" && swept === null && oldBalance > 0n && (
                <> Your <b>{fmtG$(oldBalance)} G$</b> stayed in your old wallet — it&apos;s now linked, so you can still use it.</>
              )}
            </p>
            <a href={GOODDROPS_URL} style={{ ...btn(true), textDecoration: "none" }}>
              Open GoodDrops <ArrowRight size={18} />
            </a>
            {mode === "link" && <p style={fine}>Sign in on GoodDrops with this same email — everything just works.</p>}
          </motion.div>
        )}

        {/* STEP: not found */}
        {step === "notfound" && (
          <motion.div key="notfound" className="rise" style={card}>
            <Badge icon={<AlertCircle size={13} />} tone="warn">No account found</Badge>
            <h1 style={h1}>We couldn&apos;t find your account</h1>
            <p style={sub}>
              This email isn&apos;t linked to a migratable wallet. If you have a new GoodDrops
              account, you&apos;re already good to go.
            </p>
            <a href={GOODDROPS_URL} style={{ ...btn(true), textDecoration: "none" }}>Go to GoodDrops <ArrowRight size={18} /></a>
            <button onClick={reset} disabled={signingOut} style={ghostBtn}>{signingOut ? "Signing out…" : "Try another email"}</button>
          </motion.div>
        )}

        {/* STEP: nothing to do */}
        {step === "nothingToDo" && (
          <motion.div key="nothing" className="rise" style={card}>
            <Badge icon={<AlertCircle size={13} />} tone="warn">Nothing to migrate</Badge>
            <h1 style={h1}>This wallet is empty &amp; unverified</h1>
            <p style={sub}>
              Wallet <Mono>{short(oldAddress)}</Mono> isn&apos;t GoodDollar-verified and has no G$
              to move. This tool is for verified accounts, or wallets with G$ to rescue.
            </p>
            <a href={GOODDROPS_URL} style={{ ...btn(true), textDecoration: "none" }}>Go to GoodDrops <ArrowRight size={18} /></a>
            <button onClick={reset} disabled={signingOut} style={ghostBtn}>{signingOut ? "Signing out…" : "Try another email"}</button>
          </motion.div>
        )}

        {/* STEP: error */}
        {step === "error" && (
          <motion.div key="error" className="rise" style={card}>
            <Badge icon={<AlertCircle size={13} />} tone="warn">Hit a snag</Badge>
            <h1 style={h1}>Let&apos;s try that again</h1>
            <p style={sub}>{err}</p>
            <button onClick={() => { setErr(""); setStep(oldAddress ? "pasteMagic" : "email"); }} style={btn(true)}>
              Try again <ArrowRight size={18} />
            </button>
            <button onClick={reset} disabled={signingOut} style={ghostBtn}>{signingOut ? "Signing out…" : "Sign out & start over"}</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Copy-address modal (request gas) ─────────────────────────────── */}
      {addrOpen && (
        <div onClick={() => setAddrOpen(false)} style={modalScrim}>
          <div onClick={(e) => e.stopPropagation()} className="rise" style={modalCard}>
            <button onClick={() => setAddrOpen(false)} aria-label="Close" style={modalClose}><X size={16} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Fuel size={18} color="#111" />
              <p style={{ margin: 0, fontWeight: 900, fontSize: 18 }}>Need gas for the link?</p>
            </div>
            <p style={{ ...sub, margin: "0 0 14px" }}>
              Linking your identity is one on-chain transaction, so your wallet needs a little{" "}
              <b>CELO</b> for gas. Send some CELO to this address, then come back and continue.
              {celoBal > 0n && <> You currently have <b>{(Number(celoBal) / 1e18).toFixed(4)} CELO</b>.</>}
            </p>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "#f5f4f0", border: "2px solid #111", borderRadius: 12, padding: "12px 14px",
            }}>
              <span style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 12.5, fontWeight: 700, wordBreak: "break-all" }}>
                {getAddress(oldAddress)}
              </span>
            </div>
            <button onClick={copyOldAddress} style={{ ...btn(true), marginTop: 12 }}>
              {copied ? <><Check size={18} /> Copied!</> : <><Copy size={18} /> Copy address</>}
            </button>
            <p style={fine}>Only a tiny amount is needed — Celo gas is a fraction of a cent.</p>
          </div>
        </div>
      )}

      {/* ── Recipient already verified modal ─────────────────────────────── */}
      {verifiedRoot && (
        <div onClick={() => setVerifiedRoot(null)} style={modalScrim}>
          <div onClick={(e) => e.stopPropagation()} className="rise" style={modalCard}>
            <button onClick={() => setVerifiedRoot(null)} aria-label="Close" style={modalClose}><X size={16} /></button>
            <div style={{ width: 64, height: 64, margin: "4px auto 14px", background: "#BFFD00", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BadgeCheck size={34} color="#111" strokeWidth={2.5} />
            </div>
            <p style={{ margin: "0 0 8px", fontWeight: 900, fontSize: 20, textAlign: "center" }}>
              That wallet is already verified
            </p>
            <p style={{ ...sub, textAlign: "center", margin: "0 0 18px" }}>
              <Mono>{short(magicInput.trim())}</Mono> is already linked to a GoodDollar identity —
              there&apos;s nothing to link.
              {oldBalance > 0n
                ? <> But your old wallet still holds <b>{fmtG$(oldBalance)} G$</b>. Want to move it over?</>
                : <> You&apos;re all set.</>}
            </p>
            {oldBalance > 0n ? (
              <>
                <button onClick={() => runSweepOnly(magicInput.trim())} style={btn(true)}>
                  <Coins size={18} /> Send my {fmtG$(oldBalance)} G$ instead
                </button>
                <button onClick={() => setVerifiedRoot(null)} style={ghostBtn}>Cancel</button>
              </>
            ) : (
              <>
                <a href={GOODDROPS_URL} style={{ ...btn(true), textDecoration: "none" }}>
                  Open GoodDrops <ArrowRight size={18} />
                </a>
                <button onClick={reset} disabled={signingOut} style={ghostBtn}>{signingOut ? "Signing out…" : "Use a different wallet"}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Presentational helpers ────────────────────────────────────────────────────

function Working({ title, msg }: { title: string; msg: string }) {
  return (
    <div style={{ textAlign: "center", padding: "12px 0" }}>
      <Loader2 size={44} className="spin" color="#111" style={{ margin: "0 auto 18px", display: "block" }} />
      <h1 style={{ ...h1, textAlign: "center", marginBottom: 6 }}>{title}</h1>
      <p style={{ ...sub, textAlign: "center", minHeight: 22, margin: 0 }}>{msg}</p>
    </div>
  );
}

function Badge({ children, icon, tone = "lime" }: { children: React.ReactNode; icon?: React.ReactNode; tone?: "lime" | "warn" }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: tone === "lime" ? "#111" : "#FFF3E0",
      color: tone === "lime" ? "#BFFD00" : "#B45309",
      border: tone === "warn" ? "1.5px solid #F59E0B" : "none",
      fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
      padding: "5px 11px", borderRadius: 100, marginBottom: 16, width: "fit-content",
    }}>
      {icon}{children}
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      background: "#FFE5E5", border: "1.5px solid #FF3B3B",
      color: "#C81E1E", borderRadius: 12, padding: "10px 12px",
      fontSize: 13, fontWeight: 600, margin: "8px 0 0", lineHeight: 1.4,
    }}>
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{children}</span>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#fff", border: "2.5px solid #111", borderRadius: 24,
  boxShadow: "6px 6px 0 #111", padding: "28px 26px",
};
const h1: React.CSSProperties = { fontSize: 26, fontWeight: 900, lineHeight: 1.1, margin: "0 0 10px", letterSpacing: "-0.02em" };
const sub: React.CSSProperties = { fontSize: 14.5, color: "#555", lineHeight: 1.55, margin: "0 0 18px" };
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", margin: "14px 0 7px" };
const input: React.CSSProperties = {
  width: "100%", padding: "14px 14px 14px 44px", fontSize: 16, fontWeight: 600,
  border: "2px solid #111", borderRadius: 14, outline: "none", fontFamily: "inherit", background: "#f5f4f0",
};
const inputIcon: React.CSSProperties = { position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#888" };

// Primary button — greys out and disables when `ready` is false.
function btn(ready: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "16px", marginTop: 16,
    background: ready ? "#BFFD00" : "#e8e6e0",
    color: ready ? "#111" : "#aaa",
    border: "2.5px solid", borderColor: ready ? "#111" : "#ddd",
    borderRadius: 16, boxShadow: ready ? "4px 4px 0 #111" : "none",
    fontWeight: 900, fontSize: 16, cursor: ready ? "pointer" : "not-allowed",
    fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    transition: "background 0.15s, box-shadow 0.15s",
  };
}
const secondaryBtn: React.CSSProperties = {
  width: "100%", padding: "13px", background: "#fff", color: "#111",
  border: "2px solid #111", borderRadius: 14, fontWeight: 800, fontSize: 14,
  cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
};
const ghostBtn: React.CSSProperties = {
  width: "100%", padding: "10px", marginTop: 10, background: "transparent", border: "none",
  color: "#888", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const dividerRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, margin: "14px 0" };
const dividerLine: React.CSSProperties = { flex: 1, height: 1.5, background: "#e8e6e0" };
const dividerText: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em" };
const toggleRow: React.CSSProperties = {
  width: "100%", display: "flex", alignItems: "center", gap: 12,
  border: "2px solid", borderRadius: 14, padding: "12px 14px", marginTop: 16,
  cursor: "pointer", fontFamily: "inherit", background: "#fff",
  transition: "background 0.15s, border-color 0.15s",
};
const fine: React.CSSProperties = { fontSize: 12, color: "#999", textAlign: "center", margin: "12px 0 0" };
const hintBox: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, background: "#f5f4f0",
  border: "1.5px solid #e8e6e0", borderRadius: 12, padding: "10px 12px",
  fontSize: 13, color: "#555", fontWeight: 600, marginBottom: 4,
};
const howBox: React.CSSProperties = {
  background: "#F0FDE8", border: "1.5px solid #BFFD00", borderRadius: 12,
  padding: "10px 12px", fontSize: 12.5, color: "#3f5a00", lineHeight: 1.5, margin: "14px 0 0",
};
const rescueBox: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 8,
  background: "#FFF8E6", border: "1.5px solid #F59E0B", color: "#92600A",
  borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 600, lineHeight: 1.5,
};
const successCircle: React.CSSProperties = {
  width: 80, height: 80, margin: "0 auto 16px", background: "#BFFD00",
  borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "0 0 0 6px rgba(191,253,0,0.25)",
};
const gasWarn: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 8, width: "100%",
  background: "#FFF8E6", border: "1.5px solid #F59E0B", color: "#92600A",
  borderRadius: 12, padding: "11px 13px", margin: "12px 0 0",
  fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, cursor: "pointer",
  fontFamily: "inherit", textAlign: "left",
};
const modalScrim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 100,
  background: "rgba(17,17,17,0.55)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
  fontFamily: "'Space Grotesk', sans-serif",
};
const modalCard: React.CSSProperties = {
  position: "relative", width: "100%", maxWidth: 400,
  background: "#fff", border: "2.5px solid #111", borderRadius: 22,
  boxShadow: "6px 6px 0 #111", padding: "26px 22px 22px",
};
const modalClose: React.CSSProperties = {
  position: "absolute", top: 14, right: 14,
  width: 30, height: 30, borderRadius: "50%", border: "none",
  background: "#f5f4f0", cursor: "pointer", color: "#888",
  display: "flex", alignItems: "center", justifyContent: "center",
};
