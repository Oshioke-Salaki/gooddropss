"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { celo } from "viem/chains";
import { ArrowRight, Loader2, RefreshCw, Wallet } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { VerificationModal } from "@/components/VerificationModal";
import { useVerification } from "@/hooks/useVerification";
import { publicClient } from "@/lib/publicClient";
import { readIdentityStatus, type IdentityStatus } from "@/lib/identity";
import { readLinkedRoot, isUserCancel } from "@/lib/walletLink";
import { magicOf } from "@/lib/lazyMagicConnector";
import { PARTNER_CONNECTOR_ID, rememberLogin } from "@/lib/partner";
import { toast } from "@/lib/toast";
import { Card, Step, Row, Note, Loading, Retry, short, walletName } from "@/app/switch-to-email/SwitchFlow";

// ── Renewing a linked account's verification ─────────────────────────────────
// Someone who switched to email sign-in has an email account LINKED to their
// original wallet. GoodDollar keeps the verification on that original wallet, so
// when it lapses the face scan has to happen there: a scan on the email account
// would be refused as a duplicate face. This page does only that:
//   1. connect the original wallet, 2. face scan, 3. back to the app.
// Everything here is a read or GoodDollar's own scan; nothing is sent or linked.

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SAVED = "gd:renew:account";
// Focus Pet accounts are email wallets (Web3Auth/Privy) that only the restore app
// can sign in to, so their renewal happens there.
const FOCUS_PET_RENEW_URL = "https://migrate.gooddrops.xyz/?renew=1";

type MagicSdk = { user: { isLoggedIn: () => Promise<boolean> } };

export function RenewFlow() {
  const router = useRouter();
  const { address, connector, isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const magicConnector = connectors.find((c) => c.id === "magic");
  const walletConnectors = connectors.filter((c) => c.id !== "magic" && c.id !== PARTNER_CONNECTOR_ID);
  const onEmail = isConnected && (connector?.id === "magic" || connector?.id === PARTNER_CONNECTOR_ID);
  const oldAddr = isConnected && !onEmail && address ? address.toLowerCase() : null;

  // ── The email account being renewed ────────────────────────────────────────
  // From the link (?account=), else the email account signed in right now. Kept
  // for the visit, because connecting the original wallet replaces the address.
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    if (account) return;
    const fromUrl = new URLSearchParams(window.location.search).get("account");
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(SAVED); } catch { /* storage blocked */ }
    const pick = fromUrl && ADDR_RE.test(fromUrl) ? fromUrl
      : onEmail && address ? address
      : saved && ADDR_RE.test(saved) ? saved
      : null;
    if (pick) {
      setAccount(pick.toLowerCase());
      try { sessionStorage.setItem(SAVED, pick.toLowerCase()); } catch { /* storage blocked */ }
    }
  }, [account, onEmail, address]);

  // The wallet it's linked to, always read fresh from GoodDollar.
  const [root, setRoot] = useState<string | null | undefined>(undefined);
  const [rootErr, setRootErr] = useState(false);
  const loadRoot = useCallback(async (acct: string) => {
    setRootErr(false);
    setRoot(undefined);
    try { setRoot(await readLinkedRoot(acct)); } catch { setRootErr(true); }
  }, []);
  useEffect(() => { if (account) void loadRoot(account); }, [account, loadRoot]);

  // ── The wallet they connected ──────────────────────────────────────────────
  const [oldId, setOldId] = useState<IdentityStatus | null>(null);
  const [oldErr, setOldErr] = useState(false);
  const loadOld = useCallback(async (addr: string) => {
    setOldErr(false);
    try {
      const [id, linkedTo] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        readIdentityStatus(publicClient as any, addr),
        readLinkedRoot(addr),
      ]);
      // The wallet they connected is itself the LINKED account (opened without
      // the link from the popup): it can't scan, so treat it as the account being
      // renewed and ask for the wallet it's linked to.
      if (linkedTo) setAccount((a) => a ?? addr);
      setOldId(id);
    } catch {
      setOldErr(true);
    }
  }, []);
  useEffect(() => {
    setOldId(null);
    if (oldAddr) void loadOld(oldAddr);
  }, [oldAddr, loadOld]);

  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectErr, setConnectErr] = useState("");
  async function connectOld(c: (typeof walletConnectors)[number]) {
    setConnecting(c.id);
    setConnectErr("");
    try {
      // Alongside the email session, never replacing it: disconnecting the email
      // connector would log it out and they'd need a new code to get back.
      if (isConnected && !onEmail) await disconnectAsync();
      await connectAsync({ connector: c, chainId: celo.id });
    } catch (e) {
      if (!isUserCancel(e)) setConnectErr("Couldn't connect that wallet. Open this page in your wallet app's browser, or try again.");
    } finally {
      setConnecting(null);
    }
  }

  // ── The face scan (GoodDollar's), on the connected wallet ─────────────────
  const verify = useVerification();
  useEffect(() => {
    if (verify.status === "verified" && oldAddr) void loadOld(oldAddr);
  }, [verify.status, oldAddr, loadOld]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const notLinked = !!account && root === null;           // nothing to renew elsewhere
  const isSelf = !!oldAddr && !!account && oldAddr === account;
  const wrongWallet = !!oldAddr && !!root && oldAddr !== root && !isSelf;
  const ready = !!oldAddr && !!oldId && !wrongWallet && !isSelf;
  const state = ready ? oldId!.state : null;
  const done = state === "verified";
  const blocked = state === "blacklisted";
  const step1Done = ready && !blocked;

  // Once renewed, refresh what GoodDrops remembers about both wallets, so the
  // email account counts as verified straight away (rankings, claims, profile).
  const refreshed = useRef(false);
  useEffect(() => {
    if (!done || refreshed.current) return;
    refreshed.current = true;
    for (const a of [account, oldAddr]) {
      if (a) fetch("/api/switch/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: a }) }).catch(() => {});
    }
  }, [done, account, oldAddr]);

  // ── Back to the app on the email account ───────────────────────────────────
  const [leaving, setLeaving] = useState(false);
  async function backToApp() {
    if (leaving) return;
    setLeaving(true);
    try {
      if (isConnected && !onEmail) await disconnectAsync().catch(() => {});
      const magic = await magicOf<MagicSdk>(magicConnector); // loads on first use
      const loggedIn = magic
        ? await Promise.race([magic.user.isLoggedIn().catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 6000))])
        : false;
      if (loggedIn && magicConnector) {
        try {
          await connectAsync({ connector: magicConnector, chainId: celo.id });
        } catch (e) {
          if ((e as { name?: string })?.name !== "ConnectorAlreadyConnectedError") throw e;
        }
        rememberLogin("gooddrops");
        toast.success("You're back on your email account");
      } else {
        toast.success("All set. Sign in with your email to carry on.");
      }
      try { sessionStorage.removeItem(SAVED); } catch { /* storage blocked */ }
      router.push("/");
    } catch {
      setLeaving(false);
      toast.error("Couldn't switch back. Sign in with your email from the menu.");
      router.push("/");
    }
  }

  return (
    <div className="min-h-dvh bg-surface font-sans">
      <header className="px-4 lg:px-15 h-[72px] flex items-center">
        <Link href="/" className="flex items-center gap-2.5 text-heading text-lg/none">
          <BrandMark className="w-8 h-8" />GoodDrops
        </Link>
      </header>

      <main className="px-4 pb-24">
        <div className="mx-auto w-full max-w-[600px] flex flex-col gap-4">
          <div className="pt-4 pb-2">
            <h1 className="text-[30px]/[115%] lg:text-4xl/[115%] text-heading">Renew your verification</h1>
            <p className="text-base/[150%] text-nav-muted mt-3">
              {root
                ? <>This account is linked to another wallet ({short(root)}), and that&apos;s where GoodDollar keeps your verification. Renew it there and this account is covered again straight after.</>
                : <>GoodDollar asks for a quick face scan from time to time. If your account is linked to another wallet, the scan happens on that wallet, and it covers your account too.</>}
            </p>
          </div>

          {account && rootErr && <Retry text="Couldn't check your account." onRetry={() => loadRoot(account)} />}
          {notLinked && (
            <Card>
              <p className="text-xl/[125%] text-heading">Nothing to renew here</p>
              <p className="mt-3 text-sm/[150%] text-nav-muted">
                Your account isn&apos;t linked to another wallet, so it renews by itself. Go back to GoodDrops and tap Verify.
              </p>
              <Link href="/"
                className="mt-5 h-14 w-full rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2
                  motion-safe:transition-colors hover:bg-brand/90">
                <ArrowRight className="w-5 h-5" strokeWidth={2} /> Back to GoodDrops
              </Link>
            </Card>
          )}

          {!notLinked && <>
          {/* 1 ── The original wallet */}
          <Step id="r1" n={1} title="Connect your verified wallet" state={step1Done ? "done" : "current"}>
            {oldAddr ? (
              <div className="flex flex-col gap-3">
                <Row icon={<Wallet className="w-5 h-5" strokeWidth={1.75} />} label={walletName(connector?.name)} value={short(oldAddr)} />
                {isSelf && <Note tone="danger">That&apos;s the account being renewed, so it can&apos;t do the scan itself. Connect {root ? short(root) : "the wallet it\u2019s linked to"} instead.</Note>}
                {wrongWallet && (
                  <Note tone="danger">
                    This is a different wallet. This account is linked to {short(root!)}. Connect that one instead.
                  </Note>
                )}
                {!wrongWallet && !isSelf && !oldId && !oldErr && <Loading text="Checking your wallet…" />}
                {oldErr && <Retry text="Couldn't read your wallet." onRetry={() => loadOld(oldAddr)} />}
                {blocked && <Note tone="danger">GoodDollar has blocked this wallet&apos;s verification. Message the GoodDrops team for help.</Note>}
                <button type="button" onClick={() => disconnectAsync().catch(() => {})}
                  className="self-start text-sm/none text-nav-muted underline underline-offset-4 cursor-pointer hover:text-heading">
                  Not this wallet? Disconnect
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm/[150%] text-nav-muted">
                  {root
                    ? <>Connect the wallet {short(root)}. On a phone, open this page inside that wallet app&apos;s browser, or use WalletConnect.</>
                    : <>Connect the wallet that holds your verification. On a phone, open this page inside that wallet app&apos;s browser, or use WalletConnect.</>}
                </p>
                {!mounted && <Loading text="Looking for your wallet…" />}
                {mounted && walletConnectors.map((c) => (
                  <button key={c.uid} type="button" onClick={() => connectOld(c)} disabled={!!connecting}
                    className="h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer
                      motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-70">
                    {connecting === c.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" strokeWidth={1.75} />}
                    {c.id === "walletConnect" ? "Connect with WalletConnect" : `Connect ${c.name === "Injected" ? (walletName(undefined) === "Your wallet" ? "browser wallet" : walletName(undefined)) : c.name}`}
                  </button>
                ))}
                {connectErr && <p className="text-sm/[145%] text-danger" role="alert">{connectErr}</p>}
                {root && (
                  <>
                    <Note tone="info">
                      Is that wallet in the GoodDollar wallet app, MiniPay or another app? You can renew there instead. Once it&apos;s
                      done, this account counts as verified again on GoodDrops, nothing else needed.
                    </Note>
                    {/* Focus Pet wallets are email wallets that only open on the restore app. */}
                    <a href={FOCUS_PET_RENEW_URL}
                      className="min-h-12 px-5 py-3 rounded-full border border-line bg-white text-sm/[130%] text-heading text-center flex items-center justify-center gap-2 hover:bg-surface">
                      Verified on Focus Pet? Renew here <ArrowRight className="w-4 h-4 shrink-0" strokeWidth={2} />
                    </a>
                  </>
                )}
              </div>
            )}
          </Step>

          {/* 2 ── The face scan */}
          <Step id="r2" n={2} title="Do a quick face scan" state={!step1Done ? "locked" : done ? "done" : "current"}>
            {done ? (
              <Note tone="ok">This wallet is verified{account ? ", and your email account is covered again" : ""}.</Note>
            ) : (
              <>
                <p className="text-sm/[150%] text-nav-muted">
                  It&apos;s free and takes about a minute. Use the same face as before; GoodDollar checks it&apos;s still you.
                </p>
                <button type="button" onClick={() => verify.setIsVerifying(true)}
                  className="mt-4 h-14 w-full rounded-full bg-brand text-white text-base/none cursor-pointer motion-safe:transition-colors hover:bg-brand/90">
                  Start the face scan
                </button>
                <button type="button" onClick={() => oldAddr && loadOld(oldAddr)}
                  className="mt-3 w-full h-11 rounded-full border border-line bg-white text-sm/none text-heading cursor-pointer hover:bg-surface flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" strokeWidth={2} /> I&apos;ve done it, check again
                </button>
              </>
            )}
          </Step>

          </>}

          {done && !notLinked && (
            <Card>
              <p className="text-xl/[125%] text-heading">You&apos;re all set</p>
              <p className="mt-3 text-sm/[150%] text-nav-muted">
                Your verification is active again. Go back to GoodDrops and carry on with your email account.
                It can take a few minutes for everything to catch up.
              </p>
              <button type="button" onClick={backToApp} disabled={leaving}
                className="mt-5 h-14 w-full rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer
                  motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-70">
                {leaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" strokeWidth={2} />}
                Back to GoodDrops
              </button>
            </Card>
          )}
        </div>
      </main>

      <VerificationModal
        isOpen={verify.isVerifying}
        onClose={() => verify.setIsVerifying(false)}
        fvLink={verify.fvLink}
        status={verify.status}
        onRefresh={verify.refresh}
      />
    </div>
  );
}
