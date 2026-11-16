"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWriteContract } from "wagmi";
import { celo } from "viem/chains";
import { getAddress, type Hex } from "viem";
import {
  ArrowRight, Check, Copy, Info, Loader2, Lock, Mail, RefreshCw, ShieldAlert, Wallet,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { VerificationModal } from "@/components/VerificationModal";
import { useVerification } from "@/hooks/useVerification";
import { publicClient } from "@/lib/publicClient";
import { readIdentityStatus, IDENTITY_ADDRESS, type IdentityStatus } from "@/lib/identity";
import { IDENTITY_LINK_ABI, readLinkedRoot, readRoot, isUserCancel, isEmailCancel, switchErrorMessage as plainError } from "@/lib/walletLink";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { fromDropJson, type DropJson } from "@/lib/dropJson";
import { DROP_STATUS, type Drop } from "@/types";
import { confirmTx, StillPendingError, TxFailedError } from "@/lib/txOutcome";
import { weiNeeded } from "@/lib/gasNeeds";
import { PARTNER_CONNECTOR_ID, rememberLogin } from "@/lib/partner";
import { toast } from "@/lib/toast";

// ── The switch, in plain terms ───────────────────────────────────────────────
// Someone who signs in with a browser wallet (MetaMask, etc.) wants to sign in
// with their email instead. Email sign-in gives them a NEW wallet, and GoodDollar
// won't face-verify a second wallet for the same person. So instead of verifying
// it, the original wallet LINKS it (GoodDollar connectAccount): from then on the
// email account counts as the same verified person everywhere: claims, rankings,
// streak, referrals, competition points, profile.
//
// Safety rules this page is built around:
//   • The account being linked is only ever the email account signed into ON THIS
//     PAGE. Never a pasted address: connectAccount needs no consent from the
//     linked account, so a pasted address is how someone gets tricked into handing
//     their identity to a stranger.
//   • Every on-chain step re-reads the chain first and is harmless to repeat
//     (a second link is refused, a second reclaim fails, a second send can't move
//     more than the balance), so retrying, reloading or coming back later is safe.
//   • Linking needs the original wallet to be verified RIGHT NOW (onlyWhitelisted),
//     so a lapsed one renews here first. Linked accounts come back here to renew.

type MagicSdk = {
  auth: { loginWithEmailOTP: (o: { email: string; showUI: boolean }) => Promise<unknown> };
  user: {
    isLoggedIn: () => Promise<boolean>;
    getInfo: () => Promise<{ email?: string | null; publicAddress?: string | null; wallets?: { ethereum?: { publicAddress?: string | null } } }>;
    logout: () => Promise<unknown>;
  };
  rpcProvider?: { request: (a: { method: string }) => Promise<unknown> };
};

interface EmailAcct { address: string; email: string | null }
interface OldInfo {
  identity: IdentityStatus;
  /** This wallet is itself linked to another wallet (then it can't link anything). */
  linkedTo: string | null;
  g: bigint;
  celo: bigint;
  expired: Drop[];
  live: Drop[];
}
interface EmailInfo { linkedTo: string | null; root: string | null }
interface Holdings { shops: number; shopsPayHere: number; eventsOrganized: number; eventsCohosted: number }

type TaskId = "reclaim" | "link" | "move";
type TaskState = "todo" | "active" | "done" | "skipped" | "failed";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtG = (wei: bigint) => {
  const n = Number(wei) / 1e18;
  if (n === 0) return "0";
  return n >= 1 ? Math.floor(n).toLocaleString() : n.toFixed(2);
};
const fmtDay = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// Gas budgets for the three writes (measured headroom over Celo mainnet figures).
const LINK_GAS = 120_000n;
const MOVE_GAS = 90_000n;
const RECLAIM_GAS = (n: number) => (90_000n * BigInt(Math.ceil(n / 40))) + 45_000n * BigInt(n);
const RECLAIM_BATCH = 40;

// "Injected" means nothing to a person: name the wallet app when it says who it is.
export function walletName(name: string | undefined): string {
  if (name && name !== "Injected") return name;
  if (typeof window === "undefined") return "Your wallet";
  const eth = (window as unknown as { ethereum?: Record<string, unknown> }).ethereum;
  if (eth?.isMiniPay) return "MiniPay";
  if (eth?.isValora) return "Valora";
  if (eth?.isMetaMask) return "MetaMask";
  return "Your wallet";
}

export function SwitchFlow() {
  const router = useRouter();
  const { address, connector, isConnected, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  // Wallet options are only known in the browser (the email and WalletConnect
  // connectors are added client-side), so list them after mount, never on the
  // server, or the first render can't match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const magicConnector = connectors.find((c) => c.id === "magic");
  const magic = (magicConnector as unknown as { magic?: MagicSdk } | undefined)?.magic;
  const walletConnectors = connectors.filter((c) => c.id !== "magic" && c.id !== PARTNER_CONNECTOR_ID);

  // The wallet they use now: any connected wallet that isn't an email account.
  const onEmail = isConnected && (connector?.id === "magic" || connector?.id === PARTNER_CONNECTOR_ID);
  const oldAddr = isConnected && !onEmail && address ? address.toLowerCase() : null;

  // Already switched and here to renew (an old "come back to this page" note,
  // or a saved link): the renewal page is the one for that.
  useEffect(() => {
    if (!onEmail || !address) return;
    let cancelled = false;
    Promise.all([readLinkedRoot(address), readRoot(address)])
      .then(([linked, root]) => { if (!cancelled && linked && !root) router.replace(`/renew?account=${address}`); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [onEmail, address, router]);

  // ── The email account (from Magic's session, independent of wagmi) ────────
  const [emailAcct, setEmailAcct] = useState<EmailAcct | null>(null);
  const [emailChecked, setEmailChecked] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState("");

  const readEmailSession = useCallback(async () => {
    // Development only (stripped from production builds): ?devEmail=0x… stands in
    // for a signed-in email account so the later steps can be reviewed locally.
    if (process.env.NODE_ENV !== "production") {
      const dev = new URLSearchParams(window.location.search).get("devEmail");
      if (dev && /^0x[0-9a-fA-F]{40}$/.test(dev)) { setEmailAcct({ address: dev.toLowerCase(), email: "you@example.com" }); setEmailChecked(true); return; }
    }
    if (!magic) { setEmailChecked(true); return; }
    try {
      // Magic answers from its own frame; if that's slow or blocked, don't leave
      // the person on "Checking…": after 8s show the email form instead.
      const loggedIn = await Promise.race([
        magic.user.isLoggedIn(),
        new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
      ]);
      if (!loggedIn) { setEmailAcct(null); return; }
      const info = await magic.user.getInfo();
      let addr = info.publicAddress ?? info.wallets?.ethereum?.publicAddress ?? null;
      if (!addr && magic.rpcProvider) {
        const accts = (await magic.rpcProvider.request({ method: "eth_accounts" })) as string[];
        addr = accts?.[0] ?? null;
      }
      setEmailAcct(addr ? { address: addr.toLowerCase(), email: info.email ?? null } : null);
    } catch {
      setEmailAcct(null);
    } finally {
      setEmailChecked(true);
    }
  }, [magic]);
  useEffect(() => { void readEmailSession(); }, [readEmailSession]);

  async function signInWithEmail() {
    if (!magic || emailBusy || !EMAIL_RE.test(emailInput.trim())) return;
    setEmailBusy(true);
    setEmailErr("");
    try {
      await magic.auth.loginWithEmailOTP({ email: emailInput.trim(), showUI: true });
      await readEmailSession();
    } catch (e) {
      if (!isEmailCancel(e)) setEmailErr("That didn't work. Check the code and try again.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function useDifferentEmail() {
    try { await magic?.user.logout(); } catch { /* already out */ }
    setEmailAcct(null);
    setEmailInfo(null);
    setEmailInput("");
  }

  // ── What the old wallet holds ──────────────────────────────────────────────
  const [oldInfo, setOldInfo] = useState<OldInfo | null>(null);
  const [oldErr, setOldErr] = useState(false);
  const [holdings, setHoldings] = useState<Holdings | null>(null);

  const loadOld = useCallback(async (addr: string) => {
    setOldErr(false);
    try {
      const [identity, linkedTo, g, celoBal, dropsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        readIdentityStatus(publicClient as any, addr),
        readLinkedRoot(addr),
        publicClient.readContract({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [addr as `0x${string}`] }) as Promise<bigint>,
        publicClient.getBalance({ address: addr as `0x${string}` }),
        fetch(`/api/drops/mine?address=${addr}&fresh=1`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      ]);
      const now = Math.floor(Date.now() / 1000);
      const mine = ((dropsRes.drops ?? []) as DropJson[]).map(fromDropJson)
        .filter((d) => d.dropper.toLowerCase() === addr && d.status === DROP_STATUS.Active);
      setOldInfo({
        identity, linkedTo, g, celo: celoBal,
        expired: mine.filter((d) => d.expiry <= now),
        live: mine.filter((d) => d.expiry > now).sort((a, b) => a.expiry - b.expiry),
      });
    } catch (e) {
      console.error("[switch] couldn't read wallet", e);
      setOldErr(true);
    }
    fetch(`/api/switch/holdings?address=${addr}`).then((r) => (r.ok ? r.json() : null)).then((h) => h && setHoldings(h)).catch(() => {});
  }, []);

  useEffect(() => {
    setOldInfo(null);
    setHoldings(null);
    if (oldAddr) void loadOld(oldAddr);
  }, [oldAddr, loadOld]);

  // ── What the email account is, on GoodDollar ───────────────────────────────
  const [emailInfo, setEmailInfo] = useState<EmailInfo | null>(null);
  const loadEmailInfo = useCallback(async (addr: string) => {
    try {
      const [linkedTo, root] = await Promise.all([readLinkedRoot(addr), readRoot(addr)]);
      setEmailInfo({ linkedTo, root });
    } catch {
      setEmailInfo(null);
    }
  }, []);
  useEffect(() => {
    setEmailInfo(null);
    if (emailAcct) void loadEmailInfo(emailAcct.address);
  }, [emailAcct, loadEmailInfo]);

  // ── Re-verification of the old wallet (GoodDollar's face scan) ─────────────
  const verify = useVerification();
  const reloadAfterVerify = useRef(false);
  useEffect(() => {
    // Back from a successful scan: re-read so the steps below unlock.
    if (verify.status === "verified" && reloadAfterVerify.current && oldAddr) {
      reloadAfterVerify.current = false;
      void loadOld(oldAddr);
    }
  }, [verify.status, oldAddr, loadOld]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const idState = oldInfo?.identity.state;
  const oldIsLinkedChild = !!oldInfo?.linkedTo;
  const canLink = idState === "verified" && !oldIsLinkedChild;
  const needsRenew = idState === "lapsed" && !oldIsLinkedChild;
  const sameWallet = !!emailAcct && !!oldAddr && emailAcct.address === oldAddr;
  const alreadyLinked = !!emailInfo && !!oldAddr && emailInfo.linkedTo === oldAddr;
  const emailLinkedElsewhere = !!emailInfo?.linkedTo && emailInfo.linkedTo !== oldAddr;
  const emailSelfVerified = !!emailAcct && emailInfo?.root === emailAcct.address;
  const linkWanted = canLink && !alreadyLinked && !emailLinkedElsewhere && !emailSelfVerified && !sameWallet;

  const expiredTotal = useMemo(() => (oldInfo?.expired ?? []).reduce((s, d) => s + d.amount, 0n), [oldInfo]);
  const liveTotal = useMemo(() => (oldInfo?.live ?? []).reduce((s, d) => s + d.amount, 0n), [oldInfo]);
  const [takeBack, setTakeBack] = useState(true);
  const [moveG, setMoveG] = useState(true);
  const willReclaim = takeBack && (oldInfo?.expired.length ?? 0) > 0;
  const gToMove = (oldInfo?.g ?? 0n) + (willReclaim ? expiredTotal : 0n);
  const willMove = moveG && gToMove > 0n;

  // ── Running the switch ─────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<Record<TaskId, TaskState>>({ reclaim: "todo", link: "todo", move: "todo" });
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState("");
  const [pending, setPending] = useState<Hex | null>(null);
  const [finished, setFinished] = useState(false);
  const inFlight = useRef(false);
  const setTask = (id: TaskId, s: TaskState) => setTasks((t) => ({ ...t, [id]: s }));

  async function ensureFees(gas: bigint) {
    if (!oldAddr) return;
    const [bal, price] = await Promise.all([
      publicClient.getBalance({ address: oldAddr as `0x${string}` }),
      publicClient.getGasPrice(),
    ]);
    const need = weiNeeded(price, gas);
    if (bal >= need) return;
    // A verified wallet can get a small top-up from GoodDollar's faucet.
    if (idState === "verified") {
      const res = await fetch("/api/gas-topup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: oldAddr }),
      }).then((r) => r.json()).catch(() => ({}));
      if (res?.ok) {
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const b = await publicClient.getBalance({ address: oldAddr as `0x${string}` });
          if (b >= need) return;
        }
      }
    }
    throw new Error("insufficient funds");
  }

  async function send(req: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
    // Simulate first: a revert surfaces its real reason here, before the wallet asks.
    const sim = await publicClient.simulateContract({ ...req, account: oldAddr as `0x${string}` } as never);
    const est = await publicClient.estimateContractGas({ ...req, account: oldAddr as `0x${string}` } as never).catch(() => null);
    const hash = await writeContractAsync({
      ...(sim as { request: object }).request,
      chainId: celo.id,
      ...(est ? { gas: (est * 13n) / 10n } : {}),
    } as never);
    setPending(hash);
    await confirmTx(hash);
    setPending(null);
    return hash;
  }

  async function run() {
    if (inFlight.current || !oldAddr || !emailAcct || !oldInfo) return;
    if (sameWallet) return;
    inFlight.current = true;
    setRunning(true);
    setRunErr("");
    const email = getAddress(emailAcct.address);
    let step: TaskId = "reclaim";
    try {
      if (chainId !== celo.id) await switchChainAsync({ chainId: celo.id });

      // Fees for everything still to do, topped up once up front.
      const todo = (willReclaim ? RECLAIM_GAS(oldInfo.expired.length) : 0n) + (linkWanted ? LINK_GAS : 0n) + (willMove ? MOVE_GAS : 0n);
      if (todo > 0n) await ensureFees(todo);

      // 1. Take back expired drops: re-read each on-chain (the indexer can lag)
      //    and only include ones that are still active, ours and expired.
      step = "reclaim";
      if (willReclaim) {
        setTask("reclaim", "active");
        const now = BigInt(Math.floor(Date.now() / 1000));
        const reads = await publicClient.multicall({
          contracts: oldInfo.expired.map((d) => ({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [d.id] }) as const),
          allowFailure: true,
        });
        const ids = oldInfo.expired.filter((_, i) => {
          const r = reads[i];
          if (r.status !== "success") return false;
          const d = r.result as unknown as { dropper: string; status: number; expiry: number | bigint };
          return d.dropper.toLowerCase() === oldAddr && Number(d.status) === DROP_STATUS.Active && BigInt(d.expiry) <= now;
        }).map((d) => d.id);
        // Batches of 40 keep each transaction well inside Celo's gas limit, even
        // for someone with hundreds of expired drops.
        for (let i = 0; i < ids.length; i += RECLAIM_BATCH) {
          await send({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "reclaimManyExpired", args: [ids.slice(i, i + RECLAIM_BATCH)] });
        }
        setTask("reclaim", "done");
      } else setTask("reclaim", "skipped");

      // 2. Link. Re-check first: an earlier attempt may have landed already.
      step = "link";
      if (linkWanted) {
        setTask("link", "active");
        const current = await readLinkedRoot(email);
        if (current !== oldAddr) {
          if (current) throw new Error("already connected");
          await send({ address: IDENTITY_ADDRESS, abi: IDENTITY_LINK_ABI, functionName: "connectAccount", args: [email] });
          const after = await readLinkedRoot(email);
          if (after !== oldAddr) throw new Error("link not confirmed");
        }
        // Merge rankings, streak and profile now rather than when the cache expires.
        await fetch("/api/switch/refresh", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: email }),
        }).catch(() => {});
        setTask("link", "done");
      } else setTask("link", alreadyLinked ? "done" : "skipped");

      // 3. Move G$: the whole current balance, read fresh (after the reclaim).
      step = "move";
      if (moveG) {
        setTask("move", "active");
        const bal = (await publicClient.readContract({
          address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [oldAddr as `0x${string}`],
        })) as bigint;
        if (bal > 0n) {
          try {
            await send({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [email, bal] });
          } catch (e) {
            // G$ on Celo can stream (Superfluid). With an OUTGOING stream the balance
            // shrinks every second, so "everything" read a moment ago can be a hair
            // too much by the time it's sent. Re-read and leave a tiny margin, once.
            if (e instanceof StillPendingError || isUserCancel(e)) throw e;
            const now = (await publicClient.readContract({
              address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [oldAddr as `0x${string}`],
            })) as bigint;
            const amount = now - now / 1000n; // keep 0.1% behind
            if (amount <= 0n) throw e;
            await send({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [email, amount] });
          }
        }
        setTask("move", "done");
      } else setTask("move", "skipped");

      setFinished(true);
      toast.success(linkWanted || alreadyLinked ? "Your email account is linked" : "All done");
      void loadOld(oldAddr);
      void loadEmailInfo(emailAcct.address);
    } catch (e) {
      if (e instanceof StillPendingError) {
        setTask(step, "active");
        setRunErr("This is taking longer than usual. It may still go through. Tap Check again in a minute; nothing will be sent twice.");
      } else if (e instanceof TxFailedError) {
        setPending(null);
        setTask(step, "failed");
        setRunErr("That step didn't go through. Tap Try again; we'll check what's already done first.");
      } else {
        setPending(null);
        const msg = (e as Error)?.message === "link not confirmed"
          ? "The link was sent but hasn't shown up yet. Tap Check again in a moment."
          : plainError(e);
        setTask(step, msg ? "failed" : "todo");
        setRunErr(msg);
      }
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  async function checkAgain() {
    if (pending) {
      try { await confirmTx(pending, 30_000); setPending(null); } catch { /* still unknown; run() re-checks the chain anyway */ }
    }
    await run();
  }

  // ── Finishing: sign in with the email account ─────────────────────────────
  const [switching, setSwitching] = useState(false);
  async function switchNow() {
    if (!magicConnector || switching) return;
    setSwitching(true);
    try {
      if (isConnected && !onEmail) await disconnectAsync();
      if (!onEmail) {
        try {
          await connectAsync({ connector: magicConnector, chainId: celo.id });
        } catch (e) {
          // Still connected from earlier (wagmi keeps both): that's the goal anyway.
          if ((e as { name?: string })?.name !== "ConnectorAlreadyConnectedError") throw e;
        }
      }
      rememberLogin("gooddrops");
      toast.success("You're signed in with your email");
      router.push("/");
    } catch (e) {
      console.error("[switch] email sign-in failed", e);
      setSwitching(false);
      // The email session may have ended; ask for the code again.
      await readEmailSession();
      toast.error("Sign in with your email again to finish.");
    }
  }

  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectErr, setConnectErr] = useState("");
  async function connectOld(c: (typeof walletConnectors)[number]) {
    setConnecting(c.id);
    setConnectErr("");
    try {
      // Connect ALONGSIDE an email session rather than replacing it: disconnecting
      // the email connector logs Magic out, and step 2 would need the code again.
      if (isConnected && !onEmail) await disconnectAsync();
      await connectAsync({ connector: c, chainId: celo.id });
    } catch (e) {
      if (!isUserCancel(e)) setConnectErr("Couldn't connect that wallet. Open this page in your wallet app's browser, or try again.");
    } finally {
      setConnecting(null);
    }
  }

  // ── Steps ──────────────────────────────────────────────────────────────────
  const step1Done = !!oldAddr && !!oldInfo;
  const blocked = step1Done && (idState === "blacklisted" || oldIsLinkedChild);
  const [renewSeen, setRenewSeen] = useState(false);
  useEffect(() => { if (needsRenew) setRenewSeen(true); }, [needsRenew]);
  const step2Show = needsRenew || renewSeen;
  const step2Done = !needsRenew;
  const step3Done = !!emailAcct && !sameWallet;
  // Which step needs the person now. As it advances, scroll it into view so on a
  // phone the next action is never hidden below the fold. (Not on first load.)
  const activeStep = !step1Done ? "s1" : blocked ? "s1" : !step2Done ? "s2" : !step3Done ? "s3" : "s4";
  const lastStep = useRef<string | null>(null);
  useEffect(() => {
    if (lastStep.current && lastStep.current !== activeStep) {
      const el = document.getElementById(activeStep);
      const r = el?.getBoundingClientRect();
      if (el && r && (r.top < 80 || r.top > window.innerHeight * 0.6)) {
        el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    }
    lastStep.current = activeStep;
  }, [activeStep]);

  const nothingLeft = step1Done && !blocked && step2Done && step3Done && !!emailInfo && !linkWanted && !willMove && !willReclaim;
  const everythingDone = finished || nothingLeft;

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
            <h1 className="text-[30px]/[115%] lg:text-4xl/[115%] text-heading">Switch to email sign-in</h1>
            <p className="text-base/[150%] text-nav-muted mt-3">
              Sign in with just your email from now on. You keep your verification, rankings, streak, referrals and
              competition points. It takes about three minutes.
            </p>
          </div>

          {/* What carries over and what doesn't, before anything happens. */}
          <Card>
            <p className="text-base/none text-heading">What happens</p>
            <ul className="mt-4 flex flex-col gap-3">
              <Bullet>Your email account is <b>linked</b> to your verified identity, so it counts as you everywhere on GoodDrops.</Bullet>
              <Bullet>Your <b>G$ moves</b> to your email account, and any <b>expired drops</b> come back first.</Bullet>
              <Bullet>Your <b>old wallet keeps working</b>. You can still sign in with it, and it stays the home of your verification.</Bullet>
            </ul>
          </Card>

          {/* 1 ── The wallet they use now */}
          <Step id="s1" n={1} title="Connect the wallet you use now" state={step1Done ? "done" : "current"}>
            {oldAddr ? (
              <div className="flex flex-col gap-3">
                <Row icon={<Wallet className="w-5 h-5" strokeWidth={1.75} />} label={walletName(connector?.name)} value={short(oldAddr)} />
                {oldInfo && !blocked && (
                  <p className="text-sm/[150%] text-nav-muted">
                    {idState === "verified" ? "Verified with GoodDollar" : idState === "lapsed" ? "Verification due for renewal" : "Not verified yet"}
                    {" · "}{fmtG(oldInfo.g)} G$
                    {oldInfo.expired.length + oldInfo.live.length > 0 ? ` · ${oldInfo.expired.length + oldInfo.live.length} drop${oldInfo.expired.length + oldInfo.live.length === 1 ? "" : "s"} still out` : ""}
                  </p>
                )}
                {!oldInfo && !oldErr && <Loading text="Checking your wallet…" />}
                {oldErr && <Retry text="Couldn't read your wallet." onRetry={() => loadOld(oldAddr)} />}
                {oldInfo && idState === "none" && !oldIsLinkedChild && (
                  <Note tone="info">
                    This wallet was never verified with GoodDollar, so there&apos;s no verification to carry over. We&apos;ll move
                    your G$ and you can verify your email account afterwards with a quick face scan.
                  </Note>
                )}
                {oldInfo && idState === "verified" && oldInfo.identity.isProbation && !oldIsLinkedChild && (
                  <Note tone="info">
                    Good to know: a first face scan only lasts 3 days. When it runs out, GoodDrops will ask you to renew once
                    with this wallet, and after that it lasts about 6 months. Keep this wallet app for that.
                  </Note>
                )}
                {oldInfo && idState === "blacklisted" && (
                  <Note tone="danger">GoodDollar has blocked this wallet&apos;s verification, so it can&apos;t be linked. Message the GoodDrops team for help.</Note>
                )}
                {oldInfo && oldIsLinkedChild && (
                  <Note tone="danger">
                    This wallet borrows its verification from another wallet ({short(oldInfo.linkedTo!)}). Open this page with that
                    wallet instead.
                  </Note>
                )}
                <button type="button" onClick={() => disconnectAsync().catch(() => {})}
                  className="self-start text-sm/none text-nav-muted underline underline-offset-4 cursor-pointer hover:text-heading">
                  Not this wallet? Disconnect
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm/[150%] text-nav-muted">
                  {onEmail
                    ? "You're signed in with email right now. Connect the wallet app you used before, so it can link your email account."
                    : "Connect the wallet you've been signing in with. On a phone, open this page inside your wallet app's browser."}
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
              </div>
            )}
          </Step>

          {/* 2 ── Renew (only when the wallet's verification has lapsed) */}
          {step1Done && step2Show && !blocked && (
            <Step id="s2" n={2} title="Renew your verification" state={step2Done ? "done" : "current"}>
              <p className="text-sm/[150%] text-nav-muted">
                GoodDollar asks for a quick face scan every few months, and this wallet is due. Only an active verification
                can be linked. It&apos;s free and takes about a minute.
              </p>
              <button type="button" onClick={() => { reloadAfterVerify.current = true; verify.setIsVerifying(true); }}
                className="mt-4 h-14 w-full rounded-full bg-brand text-white text-base/none cursor-pointer motion-safe:transition-colors hover:bg-brand/90">
                Renew with a face scan
              </button>
              <button type="button" onClick={() => oldAddr && loadOld(oldAddr)}
                className="mt-3 w-full h-11 rounded-full border border-line bg-white text-sm/none text-heading cursor-pointer hover:bg-surface flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" strokeWidth={2} /> I&apos;ve done it, check again
              </button>
            </Step>
          )}

          {/* 3 ── The email account */}
          <Step id="s3" n={step2Show ? 3 : 2} title="Sign in with your email" state={!step1Done || blocked || !step2Done ? "locked" : step3Done ? "done" : "current"}>
            {!emailChecked ? (
              <Loading text="Checking…" />
            ) : emailAcct ? (
              <div className="flex flex-col gap-3">
                <Row icon={<Mail className="w-5 h-5" strokeWidth={1.75} />} label={emailAcct.email ?? "Email account"} value={short(emailAcct.address)} />
                {sameWallet && <Note tone="danger">That&apos;s the same wallet. Sign in with your email instead.</Note>}
                {emailInfo && emailLinkedElsewhere && (
                  <Note tone="danger">
                    This email account is already linked to a different verified wallet ({short(emailInfo.linkedTo!)}), so it
                    can&apos;t be linked again. You can still move your G$ to it, or use a different email.
                  </Note>
                )}
                {emailInfo && emailSelfVerified && (
                  <Note tone="info">
                    This email account is already verified by itself, so there&apos;s nothing to link. You can still move your G$ to it.
                  </Note>
                )}
                {emailInfo && alreadyLinked && <Note tone="ok">Already linked to this wallet.</Note>}
                <button type="button" onClick={useDifferentEmail}
                  className="self-start text-sm/none text-nav-muted underline underline-offset-4 cursor-pointer hover:text-heading">
                  Not your email? Use a different one
                </button>
              </div>
            ) : (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void signInWithEmail(); }}>
                <p className="text-sm/[150%] text-nav-muted">
                  Enter the email you want to sign in with. We&apos;ll send you a code. If you&apos;ve signed in with this email on
                  GoodDrops before, it&apos;s the same account.
                </p>
                <input type="email" inputMode="email" autoComplete="email" value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)} placeholder="you@example.com"
                  disabled={!step1Done || blocked || !step2Done || emailBusy}
                  className="h-14 rounded-2xl bg-surface px-5 text-base text-heading placeholder:text-nav-muted outline-none focus:ring-2 focus:ring-brand disabled:opacity-60" />
                <button type="submit" disabled={!step1Done || blocked || !step2Done || emailBusy || !EMAIL_RE.test(emailInput.trim())}
                  className="h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer
                    motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed">
                  {emailBusy ? <><Loader2 className="w-5 h-5 animate-spin" /> Waiting for your code…</> : "Send me a code"}
                </button>
                {emailErr && <p className="text-sm/[145%] text-danger" role="alert">{emailErr}</p>}
              </form>
            )}
          </Step>

          {/* 4 ── Link and move */}
          <Step id="s4" n={step2Show ? 4 : 3} title={canLink || alreadyLinked ? "Link and move your G$" : "Move your G$"}
            state={!step1Done || blocked || !step2Done || !step3Done || !emailInfo ? "locked" : everythingDone ? "done" : "current"}>
            {oldInfo && emailAcct && emailInfo && !sameWallet && (
              <div className="flex flex-col gap-4">
                {!everythingDone && (
                  <ul className="flex flex-col gap-3">
                    {oldInfo.expired.length > 0 && (
                      <Task state={tasks.reclaim} label={`Take back ${oldInfo.expired.length} expired drop${oldInfo.expired.length === 1 ? "" : "s"} (${fmtG(expiredTotal)} G$)`}
                        toggle={{ on: takeBack, set: setTakeBack, disabled: running }} />
                    )}
                    {linkWanted && (
                      <Task state={tasks.link} label={`Link ${emailAcct.email ?? short(emailAcct.address)} to your verified identity`} />
                    )}
                    <Task state={tasks.move}
                      label={gToMove > 0n ? `Move ${fmtG(gToMove)} G$ to your email account` : "No G$ to move"}
                      toggle={gToMove > 0n ? { on: moveG, set: setMoveG, disabled: running } : undefined} />
                  </ul>
                )}

                {!everythingDone && (
                  <>
                    <p className="text-xs/[150%] text-nav-muted">
                      Your wallet asks you to confirm each step. Each one costs a tiny amount of CELO; if your wallet is low, we
                      try to cover it for you.
                    </p>
                    {runErr && <Note tone="danger">{runErr}</Note>}
                    {pending && !running ? (
                      <button type="button" onClick={checkAgain}
                        className="h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90">
                        <RefreshCw className="w-5 h-5" strokeWidth={2} /> Check again
                      </button>
                    ) : (
                      <button type="button" onClick={run} disabled={running || (!linkWanted && !willMove && !willReclaim)}
                        className="h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer
                          motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-60 disabled:cursor-not-allowed">
                        {running ? <><Loader2 className="w-5 h-5 animate-spin" /> Confirm in your wallet…</>
                          : runErr ? "Try again"
                          : linkWanted ? "Link my email account" : "Move my G$"}
                      </button>
                    )}
                  </>
                )}

                {everythingDone && (
                  <Note tone="ok">
                    {alreadyLinked || tasks.link === "done"
                      ? "Your email account is linked. It counts as you everywhere on GoodDrops."
                      : tasks.move === "done"
                        ? "Done. Your G$ is in your email account."
                        : "Nothing to move: this wallet has no G$ or expired drops."}
                  </Note>
                )}
              </div>
            )}
          </Step>

          {/* What stays with the old wallet, said plainly. */}
          {step1Done && oldInfo && (oldInfo.live.length > 0 || (holdings && (holdings.shops > 0 || holdings.eventsOrganized + holdings.eventsCohosted > 0))) && (
            <Card>
              <p className="text-base/none text-heading flex items-center gap-2"><Info className="w-5 h-5 text-brand" strokeWidth={1.75} />Stays with your old wallet</p>
              <ul className="mt-4 flex flex-col gap-3">
                {oldInfo.live.length > 0 && (
                  <Bullet>
                    <b>{oldInfo.live.length} drop{oldInfo.live.length === 1 ? "" : "s"} still hidden</b> ({fmtG(liveTotal)} G$). Drops can only be
                    taken back by the wallet that hid them, after they expire. If nobody finds them, come back to this page with
                    this wallet after {fmtDay(oldInfo.live[0].expiry)} to take them back.
                  </Bullet>
                )}
                {holdings && holdings.shops > 0 && (
                  <Bullet>
                    <b>{holdings.shops} shop{holdings.shops === 1 ? "" : "s"}</b> you manage with this wallet.
                    {holdings.shopsPayHere > 0 ? " Customer payments keep going to this wallet." : ""} Keep using it for your shop, or
                    message us to move it.
                  </Bullet>
                )}
                {holdings && holdings.eventsOrganized > 0 && (
                  <Bullet>
                    <b>{holdings.eventsOrganized} event{holdings.eventsOrganized === 1 ? "" : "s"}</b> you organize. Manage them with this wallet,
                    and add your email account as a co-host so its drops count for the event.
                  </Bullet>
                )}
                {holdings && holdings.eventsCohosted > 0 && (
                  <Bullet>
                    <b>{holdings.eventsCohosted} event{holdings.eventsCohosted === 1 ? "" : "s"}</b> you co-host. Ask the organizer to add your
                    email account too, so its drops count.
                  </Bullet>
                )}
              </ul>
            </Card>
          )}

          {/* Finish: sign in with email */}
          {everythingDone && emailAcct && (
            <Card>
              <p className="text-xl/[125%] text-heading">You&apos;re ready</p>
              <ul className="mt-4 flex flex-col gap-3">
                <Bullet>From now on, sign in with <b>{emailAcct.email ?? "your email"}</b> and the code we send you.</Bullet>
                {(alreadyLinked || tasks.link === "done") && (
                  <>
                    <Bullet>Rankings, streak and profile can take a few minutes to show on your email account.</Bullet>
                    <Bullet>
                      Every few months GoodDollar asks for a quick face scan. When it does, tap Verify on GoodDrops and we&apos;ll
                      walk you through renewing with your old wallet. It covers your email account too.
                    </Bullet>
                    <Bullet>GoodDollar&apos;s daily G$ is one claim per person, shared by both accounts.</Bullet>
                  </>
                )}
                {idState === "none" && !emailSelfVerified && (
                  <Bullet>Verify your email account with a quick face scan before you claim drops.</Bullet>
                )}
              </ul>
              <button type="button" onClick={switchNow} disabled={switching}
                className="mt-5 h-14 w-full rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer
                  motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-70">
                {switching ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" strokeWidth={2} />}
                {onEmail ? "Back to the map" : "Switch to email now"}
              </button>
              <CopyAddress address={emailAcct.address} />
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

// ── Pieces ───────────────────────────────────────────────────────────────────
export function Card({ children }: { children: React.ReactNode }) {
  return <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6">{children}</section>;
}

export function Step({ id, n, title, state, children }: { id: string; n: number; title: string; state: "done" | "current" | "locked"; children: React.ReactNode }) {
  return (
    <section id={id} aria-current={state === "current" ? "step" : undefined}
      className={`scroll-mt-6 bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 ${state === "locked" ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3">
        <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm/none font-anta
          ${state === "done" ? "bg-brand text-white" : state === "current" ? "bg-brand-soft text-brand" : "bg-surface text-nav-muted"}`}>
          {state === "done" ? <Check className="w-4 h-4" strokeWidth={2.5} /> : state === "locked" ? <Lock className="w-3.5 h-3.5" strokeWidth={2} /> : n}
        </span>
        <h2 className="text-lg/[125%] text-heading">{title}</h2>
      </div>
      {state !== "locked" && <div className="mt-4">{children}</div>}
    </section>
  );
}

export function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 min-w-0">
      <span className="w-9 h-9 shrink-0 rounded-full bg-white text-brand flex items-center justify-center">{icon}</span>
      <span className="text-sm/[130%] text-heading truncate flex-1 min-w-0">{label}</span>
      <span className="text-sm/none text-nav-muted tabular-nums shrink-0">{value}</span>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm/[150%] text-nav-muted [&_b]:font-normal [&_b]:text-heading">
      <span className="mt-[7px] w-1.5 h-1.5 shrink-0 rounded-full bg-brand" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export function Note({ tone, children }: { tone: "info" | "ok" | "danger"; children: React.ReactNode }) {
  const cls = tone === "danger" ? "bg-[#FFF1F1] text-heading" : tone === "ok" ? "bg-brand-soft text-heading" : "bg-surface text-heading";
  const Icon = tone === "danger" ? ShieldAlert : tone === "ok" ? Check : Info;
  return (
    <div className={`flex items-start gap-3 rounded-2xl p-4 ${cls}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon className={`w-5 h-5 shrink-0 mt-px ${tone === "danger" ? "text-danger" : "text-brand"}`} strokeWidth={2} />
      <p className="text-sm/[150%]">{children}</p>
    </div>
  );
}

function Task({ state, label, toggle }: {
  state: TaskState; label: string; toggle?: { on: boolean; set: (v: boolean) => void; disabled?: boolean };
}) {
  const off = toggle && !toggle.on;
  return (
    <li className="flex items-center gap-3 min-w-0">
      <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center
        ${state === "done" ? "bg-brand text-white" : state === "failed" ? "bg-[#FFF1F1] text-danger" : "bg-surface text-nav-muted"}`}>
        {state === "active" ? <Loader2 className="w-4 h-4 animate-spin" />
          : state === "done" ? <Check className="w-4 h-4" strokeWidth={2.5} />
          : state === "failed" ? <ShieldAlert className="w-4 h-4" strokeWidth={2} />
          : <span className="w-2 h-2 rounded-full bg-nav-muted/50" />}
      </span>
      <span className={`text-sm/[145%] flex-1 min-w-0 ${off || state === "skipped" ? "text-nav-muted line-through" : "text-heading"}`}>{label}</span>
      {toggle && (
        <button type="button" role="switch" aria-checked={toggle.on} aria-label={label} disabled={toggle.disabled}
          onClick={() => toggle.set(!toggle.on)}
          className={`relative w-11 h-6 shrink-0 rounded-full cursor-pointer motion-safe:transition-colors disabled:opacity-50 ${toggle.on ? "bg-brand" : "bg-nav-controls"}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white motion-safe:transition-transform ${toggle.on ? "translate-x-5" : ""}`} />
        </button>
      )}
    </li>
  );
}

export function Loading({ text }: { text: string }) {
  return <p className="text-sm/none text-nav-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{text}</p>;
}

export function Retry({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4" role="alert">
      <span className="text-sm/[145%] text-heading">{text}</span>
      <button type="button" onClick={onRetry} className="h-10 px-4 rounded-full bg-white text-sm/none text-heading cursor-pointer hover:bg-nav-controls">Try again</button>
    </div>
  );
}

function CopyAddress({ address }: { address: string }) {
  return (
    <button type="button"
      onClick={() => navigator.clipboard?.writeText(getAddress(address)).then(() => toast.success("Address copied")).catch(() => {})}
      className="mt-3 w-full h-11 rounded-full border border-line bg-white text-sm/none text-heading cursor-pointer hover:bg-surface flex items-center justify-center gap-2">
      <Copy className="w-4 h-4" strokeWidth={2} /> Copy your email account&apos;s address
    </button>
  );
}
