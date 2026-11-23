"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import { isAddress, getAddress, type EIP1193Provider } from "viem";
import {
  Mail, Wallet, ShieldCheck, ArrowRight, Loader2, Check, AlertCircle, ClipboardPaste, Coins,
  Copy, Fuel, X, BadgeCheck, RefreshCw,
} from "lucide-react";
import {
  loginWeb3Auth, openWeb3AuthModal, prepareWeb3Auth, logoutWeb3Auth, PopupBlockedError,
} from "@/lib/web3auth";
import { NONE, type IdentityStatus } from "@/lib/identity";
import {
  walletClientFromProvider, localCeloWalletClient, ensureCelo, identityStatus, generateReverifyLink, rootOf, linkNewWallet, sweepGDollar, gDollarBalance,
  celoBalance,
} from "@/lib/identityLink";

const GOODDROPS_URL = "https://gooddrops.xyz";
// Below this the old wallet almost certainly can't cover gas for the link tx.
const GAS_MIN_WEI = 8_000_000_000_000_000n; // 0.008 CELO
const ZERO = "0x0000000000000000000000000000000000000000";

type Step =
  | "email" | "connectOld" | "checkingWallet" | "reverify" | "pasteMagic"
  | "working" | "done" | "renewed" | "notfound" | "nothingToDo" | "error";
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
function fmtCelo(wei: bigint): string {
  const n = Number(wei) / 1e18;
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toFixed(4);
}
function short(a: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ""; }

export function MigrateFlow() {
  const { login: privyLogin, authenticated: privyAuthed, logout: privyLogout } = usePrivy();
  const { wallets } = useWallets();

  const [step, setStep]       = useState<Step>("email");
  // Opened from GoodDrops to RENEW (the account is already linked; the face scan
  // has to happen on this old wallet). Read after mount so SSR markup matches.
  const [renewMode, setRenewMode] = useState(false);
  useEffect(() => {
    try { setRenewMode(new URLSearchParams(window.location.search).has("renew")); } catch { /* no window */ }
  }, []);
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
  const [balLoading, setBalLoading] = useState(false);

  // Re-read both balances on-chain. Called when the wallet modal opens so the
  // numbers are current — e.g. G$ reads 0 right after a sweep, and CELO drops
  // once the user has sent gas in.
  const refreshBalances = useCallback(async () => {
    if (!oldAddress) return;
    setBalLoading(true);
    try {
      const [g, celo] = await Promise.all([
        gDollarBalance(oldAddress),
        celoBalance(oldAddress),
      ]);
      setOldBal(g);
      setCeloBal(celo);
    } catch {
      /* leave the last known values in place */
    } finally {
      setBalLoading(false);
    }
  }, [oldAddress]);

  useEffect(() => {
    if (addrOpen) refreshBalances();
  }, [addrOpen, refreshBalances]);

  const oldProviderRef  = useRef<EIP1193Provider | null>(null);
  // Web3Auth only: the embedded wallet key, used to sign Celo txs locally and
  // bypass Web3Auth's Celo-incompatible transaction relayer. null for Privy.
  const oldPkRef        = useRef<string | null>(null);
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

  const renewModeRef = useRef(false);
  useEffect(() => { renewModeRef.current = renewMode; }, [renewMode]);

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

      if (id.state === "verified" && renewModeRef.current) {
        // Came here to renew, and it's already active: nothing to do.
        setStep("renewed");
      } else if (id.state === "verified") {
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
        // Renewed. Linked GoodDrops accounts are covered again right away; the
        // "renewed" step also offers linking a new wallet for first-time movers.
        setMode("link");
        setStep("renewed");
      } else {
        setErr("Not verified yet — GoodDollar can take a minute to confirm. Try again shortly.");
      }
    } catch {
      setErr("Couldn't check your verification. Please try again.");
    } finally {
      setRechecking(false);
    }
  }, [oldAddress, celoBal]);

  // Build the OLD wallet's signing client.
  //   • Web3Auth (pk present): a LocalAccount client on Forno — signs Celo txs
  //     locally, bypassing Web3Auth's Celo-incompatible transaction relayer.
  //   • Privy/injected: the provider's client, first switched to Celo. `forTx`
  //     gates the switch — message signing (the FV link) works on any chain.
  const buildOldClient = useCallback(async (forTx: boolean) => {
    // Preferred path: if the embedded key is available, sign locally and broadcast
    // via Forno — no relayer involved.
    const pk = oldPkRef.current;
    if (pk) return localCeloWalletClient(pk);
    // The @web3auth/modal SDK doesn't expose eth_private_key on this plan, so sign
    // and broadcast through the provider itself. This requires Celo to be a
    // configured chain in the Web3Auth project (Chains & Networks); otherwise the
    // provider's transaction service rejects the send. ensureCelo switches the
    // provider onto Celo first (message signing, forTx = false, needs no switch).
    const provider = oldProviderRef.current;
    if (!provider) throw new Error("Your old wallet session was lost. Please start over.");
    if (forTx) await ensureCelo(provider);
    return walletClientFromProvider(provider, oldAddress);
  }, [oldAddress]);

  // Open GoodDollar's face-verification for the OLD wallet. It must be signed by
  // that wallet — verifying the new one would mint a second identity instead of
  // reviving this one.
  const startReverify = useCallback(async () => {
    if (!oldAddress) return;
    setFvBusy(true);
    setErr("");
    try {
      const client = await buildOldClient(false);
      const link = await generateReverifyLink(client, oldAddress, window.location.href);
      window.open(link, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr((e as Error).message || "Couldn't open GoodDollar verification.");
    } finally {
      setFvBusy(false);
    }
  }, [oldAddress, buildOldClient]);

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
      const { provider, address, privateKey } = await loginWeb3Auth(email.trim());
      oldPkRef.current = privateKey;
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
      const { provider, address, privateKey } = await openWeb3AuthModal();
      oldPkRef.current = privateKey;
      await afterOldLogin(provider, address);
    } catch (e) {
      setErr((e as Error).message || "Couldn't connect your Web3Auth wallet.");
    } finally {
      setBusy(false);
    }
  }, [afterOldLogin]);

  // Shared error mapping for on-chain failures.
  //
  // IMPORTANT: do NOT match on the bare word "gas". When a contract call reverts,
  // viem throws an *EstimateGasExecutionError* — whose name contains "gas" — so a
  // broad /gas/ match labels EVERY revert as "out of gas", even when the wallet
  // is funded. That's how a wallet with 1.6 CELO ended up being told it needs gas.
  // Only a genuine "insufficient funds" is a funding problem; everything else
  // must surface its real reason (and we log the full error to the console).
  const toFriendlyError = (e: unknown) => {
    const err = e as { shortMessage?: string; details?: string; message?: string };
    const msg = (err.shortMessage || err.details || err.message || "").toString();
    console.error("[migrate] on-chain action failed:", e);

    if (/insufficient funds/i.test(msg)) {
      return "Your old wallet needs a tiny amount of CELO for gas. Copy your address, send a little CELO, and try again.";
    }
    if (/user rejected|denied|cancell?ed/i.test(msg)) {
      return "You cancelled the transaction. Try again when you're ready.";
    }
    // Known GoodDollar connectAccount reverts — say what's actually wrong.
    if (/already connected/i.test(msg)) {
      return "That new wallet is already linked to a GoodDollar identity. Use a fresh wallet, or move your G$ instead.";
    }
    if (/invalid account/i.test(msg)) {
      return "That new wallet can't be linked (it's already verified or blocked). Use a different wallet.";
    }
    if (/not whitelisted|onlyWhitelisted/i.test(msg)) {
      return "Your re-verification hasn't finished confirming on-chain yet. Give it a minute and try again.";
    }
    if (/chain|network mismatch|wrong network/i.test(msg)) {
      return "Your wallet is on the wrong network. Switch it to Celo and try again.";
    }
    // Unknown: show the real short message so we're never lying about the cause.
    return msg || "Something went wrong. Please try again.";
  };

  // Move G$ from old → new wallet, no identity linking.
  const runSweepOnly = useCallback(async (magic: string) => {
    if (!oldPkRef.current && !oldProviderRef.current) return;
    setVerifiedRoot(null);
    setStep("working");
    setBusy(true);
    setErr("");
    try {
      const oldClient = await buildOldClient(true);
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
  }, [oldAddress, buildOldClient]);

  // Link the identity (link mode) then sweep G$ per the toggle.
  const runLinkAndSweep = useCallback(async (magic: string) => {
    if (!oldPkRef.current && !oldProviderRef.current) return;
    setStep("working");
    setBusy(true);
    setErr("");
    try {
      const oldClient = await buildOldClient(true);

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
  }, [oldAddress, mode, sweepEnabled, buildOldClient]);

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
      oldPkRef.current = null;
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
    <>
      {/* Top bar: the GoodDrops lockup, and once signed in, the old wallet (tap
          to copy its address and see balances, e.g. to send it gas). */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md">
        <div className="mx-auto max-w-[1080px] h-[72px] px-4 lg:px-6 flex items-center justify-between gap-3">
          <a href={GOODDROPS_URL} className="flex items-center gap-2 text-brand text-xl/none font-bold tracking-[-0.02em] shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" width={28} height={28} className="w-7 h-7" />
            GoodDrops
          </a>
          {oldAddress && (
            <button
              type="button"
              onClick={() => setAddrOpen(true)}
              title="Your old wallet: copy its address"
              className="h-11 pl-3.5 pr-1.5 rounded-full bg-white shadow-[0px_0px_12px_0px_#0000000A] flex items-center gap-2 text-sm/none text-heading cursor-pointer motion-safe:transition-colors hover:bg-white/80"
            >
              <span className="w-2 h-2 rounded-full bg-success shrink-0" />
              <span className="font-mono text-[13px]">{short(oldAddress)}</span>
              <span className="h-8 px-3 rounded-full bg-brand-soft text-brand text-xs/none flex items-center whitespace-nowrap">
                {fmtG$(oldBalance)} G$
              </span>
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 flex items-start sm:items-center justify-center px-4 pt-6 pb-8">
        <div className="w-full max-w-[440px]">
          <AnimatePresence mode="wait">
            {/* STEP: email */}
            {step === "email" && (
              <motion.div key="email" className={`rise ${CARD}`}>
                <Badge icon={<ShieldCheck size={14} />}>{renewMode ? "Renew" : "Welcome back"}</Badge>
                {renewMode ? (
                  <>
                    <h1 className={H1}>Renew your verification</h1>
                    <p className={SUB}>
                      Your GoodDrops account is linked to the wallet you first verified with (for example on
                      Focus Pet). GoodDollar renews it on that wallet. Sign in with the email you used there and
                      we&apos;ll open the face scan. Your GoodDrops account is covered again straight after.
                    </p>
                  </>
                ) : (
                  <>
                    <h1 className={H1}>Bring your verified account to GoodDrops</h1>
                    <p className={SUB}>
                      You already face-verified with GoodDollar. Link it to your new GoodDrops wallet
                      in under 2 minutes, with no new face scan.
                    </p>
                  </>
                )}
                <label htmlFor="email" className={LABEL}>Your email</label>
                <div className="relative">
                  <Mail size={18} className={INPUT_ICON} />
                  <input
                    id="email" type="email" inputMode="email" autoComplete="email" value={email} autoFocus disabled={busy}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && emailValid && !busy && handleEmail()}
                    placeholder="you@email.com" className={INPUT}
                  />
                </div>
                {err && <ErrorLine>{err}</ErrorLine>}
                <button type="button" onClick={handleEmail} disabled={!emailValid || busy} className={`${PRIMARY} mt-4`}>
                  {busy ? <><Loader2 size={18} className="animate-spin" /> Checking your account…</>
                        : <>Continue <ArrowRight size={18} /></>}
                </button>

                {/* Alternative: skip the email lookup and connect the verified wallet
                    directly via Privy's wallet modal (MetaMask, WalletConnect, …). */}
                <div className="flex items-center gap-3 my-4" aria-hidden>
                  <span className="flex-1 h-px bg-line" /><span className="text-xs/none text-nav-muted">or</span><span className="flex-1 h-px bg-line" />
                </div>
                {/* Not disabled on privyPending: if the user cancels Privy's modal we
                    must let them click again (otherwise the button stays stuck). */}
                <button type="button" onClick={connectWallet} disabled={busy} className={SECONDARY}>
                  {privyPending ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
                  Connect a wallet instead
                </button>

                <p className={FINE}>Use the same email as your previous app (like Focus Pet), or connect the wallet you verified with.</p>
              </motion.div>
            )}

            {/* STEP: connect old wallet */}
            {step === "connectOld" && (
              <motion.div key="connect" className={`rise ${CARD}`}>
                <Badge icon={<Wallet size={14} />}>Step 1 of 2</Badge>
                <h1 className={H1}>Sign in to your old wallet</h1>
                <p className={SUB}>
                  We found your account. Sign in with your{" "}
                  <b className="font-medium text-heading">{authType === "privy" ? "email wallet" : "Web3Auth account"}</b> so it can
                  {renewMode ? " do the face scan." : " authorize the link."}
                </p>
                {oldHint && (
                  <div className={`${INFO} flex items-center gap-2.5`}>
                    <Wallet size={16} className="text-nav-muted shrink-0" />
                    <span>Your wallet <Mono>{short(oldHint)}</Mono></span>
                  </div>
                )}
                {err && <ErrorLine>{err}</ErrorLine>}
                {authType === "privy" ? (
                  <button type="button" onClick={connectPrivy} className={`${PRIMARY} mt-4`}>
                    <Mail size={18} /> {privyAuthed ? "Continue" : "Sign in with email"}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={connectWeb3Auth} disabled={busy} className={`${PRIMARY} mt-4`}>
                      {busy ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
                      {busy ? "Opening…" : "Sign in with Web3Auth"}
                    </button>
                    {popupBlocked && (
                      <button type="button" onClick={connectWeb3AuthModal} disabled={busy} className={`${SECONDARY} mt-3`}>
                        <Wallet size={16} /> Open the Web3Auth window instead
                      </button>
                    )}
                  </>
                )}
                <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Use a different email"}</GhostButton>
              </motion.div>
            )}

            {/* STEP: checking wallet on-chain */}
            {step === "checkingWallet" && (
              <motion.div key="checking" className={`rise ${CARD}`}>
                <Working title="Checking your wallet" msg="Reading your GoodDollar verification and G$ balance…" />
              </motion.div>
            )}

            {/* STEP: lapsed verification — must re-verify BEFORE linking.
                connectAccount() is onlyWhitelisted, so this is a hard gate. */}
            {step === "reverify" && (
              <motion.div key="reverify" className={`rise ${CARD}`}>
                <Badge icon={<ShieldCheck size={14} />}>One quick step</Badge>

                <div className={`${NOTE_WARN} flex gap-3 items-start`}>
                  <BadgeCheck size={18} className="shrink-0 mt-0.5" />
                  <span>
                    {identity.isProbation ? (
                      <><b className="font-medium">Good news: you are face-verified.</b> GoodDollar only keeps a
                      first-time verification active for <b className="font-medium">3 days</b>, and yours has since
                      run out. Renew once and it lasts about <b className="font-medium">6 months</b>.</>
                    ) : (
                      <><b className="font-medium">Good news: you are face-verified.</b> GoodDollar asks for a quick
                      face scan every few months, and yours is due. It only takes a minute.</>
                    )}
                  </span>
                </div>

                <h1 className={`${H1} mt-5`}>{renewMode ? "Renew your verification" : "Re-verify to keep your identity"}</h1>
                <p className={SUB}>
                  Your identity lives on <Mono>{short(oldAddress)}</Mono>, so this is the wallet that
                  does the face scan.{" "}
                  {renewMode
                    ? <>Your GoodDrops account is linked to it, so it&apos;s covered again as soon as you&apos;re done.</>
                    : <>That&apos;s what lets us move it to your new one.</>}
                  {oldBalance > 0n && <> Your <b className="font-medium text-heading">{fmtG$(oldBalance)} G$</b> is safe.</>}
                </p>

                <ol className="mt-4 rounded-2xl bg-surface p-4 flex flex-col gap-3 text-sm/[140%] text-heading">
                  {[
                    <>Tap <b className="font-medium">Start the face scan</b> (opens in a new tab).</>,
                    <>Complete the quick face check, using the same face as before.</>,
                    <>Come back to this tab and tap <b className="font-medium">I&apos;ve done it</b>.</>,
                  ].map((t, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-6 h-6 shrink-0 rounded-full bg-brand text-white text-xs/none flex items-center justify-center">{i + 1}</span>
                      <span className="pt-0.5">{t}</span>
                    </li>
                  ))}
                </ol>

                {err && <ErrorLine>{err}</ErrorLine>}

                <button type="button" onClick={startReverify} disabled={fvBusy} className={`${PRIMARY} mt-4`}>
                  {fvBusy
                    ? <><Loader2 size={18} className="animate-spin" /> Opening…</>
                    : <><ShieldCheck size={18} /> Start the face scan</>}
                </button>

                <button type="button" onClick={recheckIdentity} disabled={rechecking} className={`${SECONDARY} mt-3`}>
                  {rechecking
                    ? <><Loader2 size={16} className="animate-spin" /> Checking…</>
                    : <><Check size={16} /> I&apos;ve done it, check again</>}
                </button>

                {/* Escape hatch. Deliberately understated and honest about the cost:
                    sweeping abandons a recoverable identity. */}
                {oldBalance > 0n && !renewMode && (
                  <GhostButton onClick={() => { setMode("rescue"); setStep("pasteMagic"); setErr(""); }}>
                    Skip, just move my {fmtG$(oldBalance)} G$ (identity stays behind)
                  </GhostButton>
                )}

                <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out and start over"}</GhostButton>
              </motion.div>
            )}

            {/* STEP: paste new wallet */}
            {step === "pasteMagic" && (
              <motion.div key="paste" className={`rise ${CARD}`}>
                <Badge icon={<ClipboardPaste size={14} />}>Step 2 of 2</Badge>
                {mode === "link" ? (
                  <>
                    <h1 className={H1}>Paste your new GoodDrops wallet</h1>
                    <p className={SUB}>
                      Wallet <Mono>{short(oldAddress)}</Mono> is verified
                      {oldBalance > 0n && <> and holds <b className="font-medium text-heading">{fmtG$(oldBalance)} G$</b></>}.
                      Paste your new GoodDrops wallet and we&apos;ll link your identity to it
                      {oldBalance > 0n ? " and move your G$ over" : ""}.
                    </p>
                  </>
                ) : (
                  <>
                    <div className={`${NOTE_WARN} flex gap-3 items-start`}>
                      <Coins size={18} className="shrink-0 mt-0.5" />
                      <span>
                        {identity.state === "lapsed" ? (
                          // They got here by explicitly skipping the re-verify step: they
                          // DO have an identity, and it stays recoverable.
                          <>
                            Moving your <b className="font-medium">{fmtG$(oldBalance)} G$</b> only. Your verified identity
                            stays on <Mono>{short(oldAddress)}</Mono>: re-verify any time to link it
                            to your new wallet.
                          </>
                        ) : (
                          <>
                            This wallet has never been GoodDollar-verified, so there&apos;s no identity
                            to link, but it holds <b className="font-medium">{fmtG$(oldBalance)} G$</b>. Paste your new wallet
                            to move your G$ out.
                          </>
                        )}
                      </span>
                    </div>
                    <h1 className={`${H1} mt-5`}>Rescue your G$</h1>
                    <p className={SUB}>Enter the wallet you want your <b className="font-medium text-heading">{fmtG$(oldBalance)} G$</b> sent to.</p>
                    {identity.state === "lapsed" && (
                      <button type="button" onClick={() => { setStep("reverify"); setErr(""); }} className={`${SECONDARY} mt-4`}>
                        <ShieldCheck size={16} /> Re-verify instead and keep my identity
                      </button>
                    )}
                  </>
                )}
                <div className={`${INFO} mt-4`}>
                  <b className="font-medium text-heading">Where to find it:</b> open GoodDrops, tap your wallet, then <b className="font-medium text-heading">Copy address</b>.
                </div>

                {/* Low-gas warning: the old wallet needs CELO to sign the link transaction. */}
                {lowGas && (
                  <button type="button" onClick={() => setAddrOpen(true)} className={`${NOTE_WARN} mt-3 w-full flex gap-3 items-start text-left cursor-pointer motion-safe:transition-opacity hover:opacity-90`}>
                    <Fuel size={18} className="shrink-0 mt-0.5" />
                    <span><b className="font-medium">Your old wallet is low on CELO for gas.</b> Tap to copy its address and send a little CELO.</span>
                  </button>
                )}

                <label htmlFor="magic" className={LABEL}>New wallet address</label>
                <div className="relative">
                  <Wallet size={18} className={INPUT_ICON} />
                  <input
                    id="magic"
                    value={magicInput}
                    onChange={(e) => setMagicIn(e.target.value)}
                    placeholder="0x…" spellCheck={false} autoCapitalize="off" autoCorrect="off"
                    aria-invalid={!!magicInput && !magicValid}
                    className={`${INPUT} font-mono text-sm pr-12 ${magicInput && !magicValid ? "border-danger/60" : ctaReady ? "border-success/60" : ""}`}
                  />
                  {ctaReady && <Check size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-success" />}
                </div>
                {ctaReady && (
                  <p className="mt-2 px-1 text-xs/[150%] text-success break-all">Sending to {getAddress(magicInput.trim())}</p>
                )}
                {magicSameAsOld && <ErrorLine>That&apos;s your old wallet. Paste your NEW one.</ErrorLine>}
                {err && <ErrorLine>{err}</ErrorLine>}

                {/* Optional G$ sweep: verified users can leave their G$ in the old wallet. */}
                {mode === "link" && oldBalance > 0n && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={sweepEnabled}
                    onClick={() => setSweep((v) => !v)}
                    className={`mt-4 w-full flex items-center gap-3 rounded-2xl border p-4 text-left cursor-pointer motion-safe:transition-colors
                      ${sweepEnabled ? "border-brand/30 bg-brand-soft/60" : "border-line bg-white hover:bg-surface"}`}
                  >
                    <span className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center motion-safe:transition-colors
                      ${sweepEnabled ? "bg-brand text-white" : "border border-[#D4D4D4] bg-white"}`}>
                      {sweepEnabled && <Check size={14} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm/[130%] text-heading">Also move my {fmtG$(oldBalance)} G$</span>
                      <span className="block mt-1 text-xs/[140%] text-nav-muted">
                        {sweepEnabled ? "Recommended: sends your G$ to the new wallet" : "Your G$ will stay in your old wallet"}
                      </span>
                    </span>
                  </button>
                )}

                <button type="button" onClick={onSubmit} disabled={!ctaReady || preChecking} className={`${PRIMARY} mt-4`}>
                  {preChecking ? <><Loader2 size={18} className="animate-spin" /> Checking…</>
                    : <>{mode === "rescue"
                        ? "Move my G$ out"
                        : sweepEnabled && oldBalance > 0n
                          ? "Link and move my G$"
                          : "Link my account"} <ArrowRight size={18} /></>}
                </button>
                <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out and start over"}</GhostButton>
              </motion.div>
            )}

            {/* STEP: working */}
            {step === "working" && (
              <motion.div key="working" className={`rise ${CARD}`}>
                <Working title={mode === "link" ? "Restoring your account" : "Moving your G$"} msg={workMsg} />
                <p className={FINE}>Approve any prompts from your old wallet. This can take a moment.</p>
              </motion.div>
            )}

            {/* STEP: done */}
            {step === "done" && (
              <motion.div key="done" className={`rise ${CARD} text-center`}>
                <SuccessMark />
                <h1 className={`${H1} text-center`}>{mode === "link" ? "You're all set" : "G$ moved"}</h1>
                <p className={`${SUB} text-center`}>
                  {mode === "link" ? (
                    <>Your verified GoodDollar identity now lives on your new wallet <Mono>{short(magicInput.trim())}</Mono>.</>
                  ) : (
                    <>Your G$ is now in <Mono>{short(magicInput.trim())}</Mono>.</>
                  )}
                  {swept !== null && swept > 0n && <> We moved <b className="font-medium text-heading">{fmtG$(swept)} G$</b> across.</>}
                  {mode === "link" && swept === null && oldBalance > 0n && (
                    <> Your <b className="font-medium text-heading">{fmtG$(oldBalance)} G$</b> stayed in your old wallet. It&apos;s now linked, so you can still use it.</>
                  )}
                </p>
                <a href={GOODDROPS_URL} className={`${PRIMARY} mt-6`}>Open GoodDrops <ArrowRight size={18} /></a>
                {mode === "link" && <p className={FINE}>Sign in on GoodDrops with this same email. Everything just works.</p>}
              </motion.div>
            )}

            {/* STEP: renewed — the old wallet is verified again */}
            {step === "renewed" && (
              <motion.div key="renewed" className={`rise ${CARD} text-center`}>
                <SuccessMark />
                <h1 className={`${H1} text-center`}>You&apos;re verified</h1>
                <p className={`${SUB} text-center`}>
                  <Mono>{short(oldAddress)}</Mono> is verified with GoodDollar. Any GoodDrops account linked to it
                  counts as verified again right away. Go back to GoodDrops and sign in as usual.
                </p>
                <a href={GOODDROPS_URL} className={`${PRIMARY} mt-6`}>Back to GoodDrops <ArrowRight size={18} /></a>
                {!renewMode && (
                  <button type="button" onClick={() => { setErr(""); setStep("pasteMagic"); if (celoBal < GAS_MIN_WEI) setAddrOpen(true); }} className={`${SECONDARY} mt-3`}>
                    <Wallet size={16} /> Link it to a new GoodDrops wallet
                  </button>
                )}
                <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</GhostButton>
              </motion.div>
            )}

            {/* STEP: not found */}
            {step === "notfound" && (
              <motion.div key="notfound" className={`rise ${CARD}`}>
                <Badge icon={<AlertCircle size={14} />} tone="warn">No account found</Badge>
                <h1 className={H1}>We couldn&apos;t find your account</h1>
                <p className={SUB}>
                  This email isn&apos;t linked to a migratable wallet. If you have a new GoodDrops
                  account, you&apos;re already good to go.
                </p>
                <a href={GOODDROPS_URL} className={`${PRIMARY} mt-6`}>Go to GoodDrops <ArrowRight size={18} /></a>
                <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Try another email"}</GhostButton>
              </motion.div>
            )}

            {/* STEP: nothing to do */}
            {step === "nothingToDo" && (
              <motion.div key="nothing" className={`rise ${CARD}`}>
                <Badge icon={<AlertCircle size={14} />} tone="warn">Nothing to move</Badge>
                <h1 className={H1}>This wallet is empty and unverified</h1>
                <p className={SUB}>
                  Wallet <Mono>{short(oldAddress)}</Mono> isn&apos;t GoodDollar-verified and has no G$
                  to move. This tool is for verified accounts, or wallets with G$ to rescue.
                </p>
                <a href={GOODDROPS_URL} className={`${PRIMARY} mt-6`}>Go to GoodDrops <ArrowRight size={18} /></a>
                <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Try another email"}</GhostButton>
              </motion.div>
            )}

            {/* STEP: error */}
            {step === "error" && (
              <motion.div key="error" className={`rise ${CARD}`}>
                <Badge icon={<AlertCircle size={14} />} tone="warn">Hit a snag</Badge>
                <h1 className={H1}>Let&apos;s try that again</h1>
                <p className={SUB}>{err}</p>
                <button type="button" onClick={() => { setErr(""); setStep(oldAddress ? "pasteMagic" : "email"); }} className={`${PRIMARY} mt-6`}>
                  Try again <ArrowRight size={18} />
                </button>
                <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out and start over"}</GhostButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Your wallet: copy the address, see balances (e.g. to send gas) ─── */}
      {addrOpen && (
        <Modal title="Your old wallet" onClose={() => setAddrOpen(false)}
          action={
            <button type="button" onClick={refreshBalances} disabled={balLoading} aria-label="Refresh balances" title="Refresh balances"
              className="w-9 h-9 rounded-full bg-surface text-nav-muted flex items-center justify-center cursor-pointer hover:text-heading disabled:cursor-wait">
              <RefreshCw size={15} className={balLoading ? "animate-spin" : undefined} />
            </button>
          }>
          <div className="flex items-center gap-3 rounded-2xl bg-surface p-3 pl-4">
            <span className="w-2 h-2 rounded-full bg-success shrink-0" />
            <span className="flex-1 min-w-0 font-mono text-[13px]/[150%] text-heading break-all">{getAddress(oldAddress)}</span>
            <button type="button" onClick={copyOldAddress} aria-label="Copy address"
              className={`h-9 px-3.5 shrink-0 rounded-full text-xs/none flex items-center gap-1.5 cursor-pointer motion-safe:transition-colors
                ${copied ? "bg-success text-white" : "bg-brand text-white hover:bg-brand/90"}`}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <BalanceTile label="G$ balance" value={balLoading && oldBalance === 0n ? "…" : fmtG$(oldBalance)} unit="G$" />
            <BalanceTile label="Gas (CELO)" value={balLoading && celoBal === 0n ? "…" : fmtCelo(celoBal)} unit="CELO" warn={lowGas} />
          </div>

          {/* Gas guidance, only when it's low enough to block the link transaction. */}
          {lowGas ? (
            <div className={`${NOTE_WARN} mt-3 flex gap-3 items-start`}>
              <Fuel size={18} className="shrink-0 mt-0.5" />
              <span>
                Linking your identity is one on-chain transaction, so this wallet needs a little{" "}
                <b className="font-medium">CELO</b> for gas. Copy the address above, send a small amount, then tap refresh.
                It&apos;s a fraction of a cent.
              </span>
            </div>
          ) : (
            <p className={FINE}>Send CELO or G$ to the address above. Tap refresh to update.</p>
          )}
        </Modal>
      )}

      {/* ── Recipient already verified ─────────────────────────────────────── */}
      {verifiedRoot && (
        <Modal title="Already verified" onClose={() => setVerifiedRoot(null)}>
          <div className="text-center">
            <span className="mx-auto w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
              <BadgeCheck size={32} strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-xl/[130%] text-heading">That wallet is already verified</p>
            <p className={`${SUB} text-center`}>
              <Mono>{short(magicInput.trim())}</Mono> is already linked to a GoodDollar identity, so
              there&apos;s nothing to link.
              {oldBalance > 0n
                ? <> But your old wallet still holds <b className="font-medium text-heading">{fmtG$(oldBalance)} G$</b>. Want to move it over?</>
                : <> You&apos;re all set.</>}
            </p>
          </div>
          {oldBalance > 0n ? (
            <>
              <button type="button" onClick={() => runSweepOnly(magicInput.trim())} className={`${PRIMARY} mt-5`}>
                <Coins size={18} /> Send my {fmtG$(oldBalance)} G$ instead
              </button>
              <GhostButton onClick={() => setVerifiedRoot(null)}>Cancel</GhostButton>
            </>
          ) : (
            <>
              <a href={GOODDROPS_URL} className={`${PRIMARY} mt-5`}>Open GoodDrops <ArrowRight size={18} /></a>
              <GhostButton onClick={reset} disabled={signingOut}>{signingOut ? "Signing out…" : "Use a different wallet"}</GhostButton>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

// ── Design system: the same classes as the main GoodDrops app (dapp/) ─────────

const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 sm:p-7";
const H1 = "text-[26px]/[120%] sm:text-[28px]/[120%] text-heading tracking-[-0.01em] mb-3";
const SUB = "text-[15px]/[155%] text-nav-muted mt-1";
const LABEL = "block mt-5 mb-2 px-1 text-sm/none text-heading";
const INPUT = "w-full h-14 rounded-full bg-surface border border-transparent pl-12 pr-5 text-base text-heading placeholder:text-nav-muted outline-none motion-safe:transition-colors focus:border-brand focus:bg-white disabled:opacity-60";
const INPUT_ICON = "absolute left-5 top-1/2 -translate-y-1/2 text-nav-muted pointer-events-none";
const PRIMARY = "w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed";
const SECONDARY = "w-full h-12 rounded-full border border-line bg-white text-heading text-sm/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface disabled:opacity-60 disabled:cursor-wait";
const FINE = "mt-4 text-xs/[150%] text-nav-muted text-center";
const INFO = "rounded-2xl bg-surface p-4 text-sm/[150%] text-nav-muted";
const NOTE_WARN = "rounded-2xl bg-[#FFF5E9] p-4 text-sm/[150%] text-[#8A4B00]";

function GhostButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="mt-2 w-full min-h-11 px-4 py-3 rounded-3xl text-sm/[140%] text-nav-muted cursor-pointer motion-safe:transition-colors hover:bg-surface hover:text-heading disabled:cursor-wait">
      {children}
    </button>
  );
}

function Working({ title, msg }: { title: string; msg: string }) {
  return (
    <div className="text-center py-3" role="status" aria-live="polite">
      <span className="mx-auto w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
        <Loader2 size={30} className="animate-spin" />
      </span>
      <h1 className={`${H1} text-center mt-5`}>{title}</h1>
      <p className={`${SUB} text-center min-h-6`}>{msg}</p>
    </div>
  );
}

function SuccessMark() {
  return (
    <span className="pop mx-auto mb-5 w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
      <Check size={32} strokeWidth={2.25} />
    </span>
  );
}

function Badge({ children, icon, tone = "brand" }: { children: React.ReactNode; icon?: React.ReactNode; tone?: "brand" | "warn" }) {
  return (
    <span className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs/none
      ${tone === "brand" ? "bg-brand-soft text-brand" : "bg-[#FFF5E9] text-[#B45309]"}`}>
      {icon}{children}
    </span>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="mt-3 flex items-start gap-2.5 rounded-2xl bg-[#FFF1F1] px-4 py-3 text-sm/[145%] text-danger">
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function BalanceTile({ label, value, unit, warn = false }: { label: string; value: string; unit: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <p className="text-xs/none text-nav-muted">{label}</p>
      <p className={`mt-2 text-2xl/none tabular-nums ${warn ? "text-[#B45309]" : "text-heading"}`}>
        {value}<span className="ml-1 text-xs text-nav-muted">{unit}</span>
      </p>
    </div>
  );
}

/**
 * The app's modal: a bottom sheet on phones, a centred card on larger screens,
 * with a title row and a round close button (as in the main app's Sheet).
 * Closes on the backdrop and on Escape.
 */
function Modal({ title, onClose, action, children }: { title: string; onClose: () => void; action?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="rise w-full max-w-[420px] bg-white rounded-3xl p-6 pb-[max(24px,env(safe-area-inset-bottom))] shadow-[0_24px_60px_rgba(0,0,0,0.18)]">
        <div className="flex items-center gap-3 mb-5">
          <p className="flex-1 text-lg/none text-heading">{title}</p>
          {action}
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-9 h-9 rounded-full bg-surface text-nav-muted flex items-center justify-center cursor-pointer hover:text-heading">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-[0.92em] text-heading">{children}</span>
);
