"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { celo } from "viem/chains";
import { parseUnits, isAddress, getAddress, formatUnits } from "viem";
import { X, Loader2, Check, Clipboard, AtSign, AlertCircle, Wallet } from "lucide-react";
import { G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { formatG$ } from "@/lib/utils";
import { confirmTx, StillPendingError } from "@/lib/txOutcome";
import { friendlyClaimError } from "@/lib/claimErrors";
import { toast } from "@/lib/toast";
import { useSheetDrag } from "@/hooks/useSheetDrag";
import { useEscapeLayer, useFocusReturn } from "@/components/ui/layers";
import { Avatar } from "@/components/Avatar";
import { BigAmountInput } from "@/components/ui/BigAmountInput";
import { useProfile } from "@/hooks/useProfile";

interface Props {
  address: `0x${string}`;
  balance: bigint;
  onClose: () => void;
}

const BTN = "shrink-0 w-full h-12 rounded-full bg-brand text-white text-[15px]/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 transition-[transform,background-color] duration-150 active:scale-[0.98] disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:active:scale-100";
const CHIP = "h-8 px-3.5 rounded-full bg-surface text-[13px]/none text-heading cursor-pointer hover:bg-[#ECECEC] transition-[transform,background-color] duration-150 active:scale-[0.95] disabled:opacity-50";

const groupDigits = (v: string) => { const [w, f] = v.split("."); return (w ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? `.${f}` : ""); };
const cleanAmount = (v: string) => v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^(\d*\.\d{0,2}).*$/, "$1");
const fmtG = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Recipient =
  | { state: "empty" }
  | { state: "looking" }
  | { state: "found"; address: `0x${string}`; username?: string }
  | { state: "error"; message: string };

/**
 * Send G$ to a GoodDrops username or any wallet address. The recipient is
 * resolved and shown (avatar, name, the exact address) before the button is
 * live, because a send can't be undone. Amount works like Withdraw: one big
 * number, quick fractions, the balance beside it.
 */
export function SendGModal({ address, balance, onClose }: Props) {
  const busyRef = useRef(false);
  const { sheetRef, sheetStyle, handleProps } = useSheetDrag({ onDismiss: () => { if (!busyRef.current) onClose(); } });

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState<Recipient>({ state: "empty" });
  const [status, setStatus] = useState<"idle" | "sending" | "checking" | "pending" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | "">("");
  const [sentTo, setSentTo] = useState<{ amount: string; label: string } | null>(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useSponsoredWrite();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const sending = status === "sending" || status === "checking";
  busyRef.current = sending;
  useEscapeLayer(true, () => { if (!sending) onClose(); });
  useFocusReturn(true, sheetRef);

  // Resolve what they typed: a 0x address as is, anything else as a username.
  useEffect(() => {
    const raw = to.trim();
    if (!raw) { setRecipient({ state: "empty" }); return; }
    if (/^0x/i.test(raw)) {
      if (!isAddress(raw)) { setRecipient(raw.length >= 42 ? { state: "error", message: "That isn't a valid wallet address." } : { state: "empty" }); return; }
      const a = getAddress(raw);
      setRecipient(a.toLowerCase() === address.toLowerCase() ? { state: "error", message: "That's your own wallet." } : { state: "found", address: a });
      return;
    }
    const name = raw.replace(/^@/, "");
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(name)) { setRecipient(name.length >= 3 ? { state: "error", message: "Usernames use letters, numbers, _ and -." } : { state: "empty" }); return; }
    setRecipient({ state: "looking" });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/profile/resolve?username=${encodeURIComponent(name)}`);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok || !d.address) { setRecipient({ state: "error", message: d.error ?? "No one has that username." }); return; }
        const a = getAddress(d.address);
        setRecipient(a.toLowerCase() === address.toLowerCase() ? { state: "error", message: "That's you." } : { state: "found", address: a, username: d.username });
      } catch { if (!cancelled) setRecipient({ state: "error", message: "You seem to be offline." }); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [to, address]);

  const balG = Number(formatUnits(balance, 18));
  const amountNum = Number(amount);
  const amountErr = amount && amountNum > balG ? "That's more G$ than you have." : "";
  const ready = recipient.state === "found" && amountNum > 0 && !amountErr && !sending;

  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) setTo(t.trim()); } catch { /* permission denied: they can type */ }
  };
  const setFraction = (f: number) => {
    if (f === 1) { setAmount((balance / 10n ** 18n).toString()); return; }
    setAmount(String(Math.floor(balG * f)));
  };

  async function handleSend() {
    if (recipient.state !== "found") return;
    setErr("");
    let amountWei: bigint;
    try { amountWei = parseUnits(amount, 18); } catch { setErr("Enter a valid amount."); return; }
    if (amountWei <= 0n || amountWei > balance) { setErr("That's more G$ than you have."); return; }
    const dest = recipient.address;
    const label = recipient.username ? `@${recipient.username}` : shortAddr(dest);

    setStatus("sending");
    try {
      if (chainId !== celo.id) {
        try { await switchChainAsync({ chainId: celo.id }); }
        catch { setStatus("error"); setErr("Your wallet needs to switch to Celo first. Approve the switch, then try again."); return; }
      }
      if (publicClient) {
        try {
          await publicClient.simulateContract({ account: address, address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [dest, amountWei] });
        } catch (e) {
          const fe = friendlyClaimError(e);
          setStatus("error");
          setErr(fe.kind === "network" ? fe.message : "This send wouldn't go through. Check the amount and try again. Nothing was sent.");
          return;
        }
      }
      const hash = await writeContractAsync({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [dest, amountWei] });
      setTxHash(hash);
      setSentTo({ amount, label });
      await finish(hash, label);
    } catch (e) {
      const fe = friendlyClaimError(e);
      if (fe.kind === "rejected") { setStatus("idle"); return; }
      setStatus("error");
      setErr(fe.kind === "gas"
        ? "Sending needs a tiny amount of CELO to cover the cost, and this wallet doesn't have enough. Add a little, then try again."
        : fe.kind === "unknown" ? "That send didn't go through. Nothing left your wallet. Please try again." : fe.message);
    }
  }

  async function finish(hash: `0x${string}`, label: string) {
    try {
      await confirmTx(hash);
      setStatus("done");
      toast.success(`Sent ${fmtG(Number(amount))} G$ to ${label}`);
      window.dispatchEvent(new Event("gd:verified"));
    } catch (e) {
      if (e instanceof StillPendingError) { setStatus("pending"); setErr(""); return; }
      setStatus("error");
      setErr("That send didn't go through. Nothing left your wallet. Please try again.");
    }
  }

  async function checkAgain() {
    if (!txHash || !sentTo) return;
    setStatus("checking");
    await finish(txHash, sentTo.label);
  }

  function reset() {
    setTo(""); setAmount(""); setErr(""); setTxHash(""); setSentTo(null); setStatus("idle");
  }

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label="Send G$"
      tabIndex={-1}
      className="outline-none bg-white rounded-t-3xl lg:rounded-3xl p-6 flex flex-col gap-y-5 font-sans
        max-h-[88dvh] overflow-y-auto lg:max-h-none lg:overflow-visible panel-in-lg"
      style={{ boxShadow: "0px 0px 12px 0px #0000000A", paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))", ...sheetStyle }}
    >
      <div {...handleProps}>
        <span aria-hidden className="lg:hidden block w-9 h-1 mx-auto -mt-2 mb-4 rounded-full bg-line" />
        <div className="flex items-center justify-between">
          <h2 className="text-base/[100%] text-heading">Send G$</h2>
          <button onClick={onClose} disabled={sending} aria-label="Close"
            className="p-1.5 text-black rounded-full bg-surface cursor-pointer hover:bg-[#ECECEC] transition-[transform,background-color] duration-150 active:scale-[0.94] disabled:opacity-40 disabled:cursor-not-allowed">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {status === "done" && sentTo ? (
        <div className="flex flex-col items-center text-center gap-5 pt-1">
          <span className="w-12 h-12 rounded-full bg-brand text-white flex items-center justify-center"><Check className="w-6 h-6" strokeWidth={2.25} /></span>
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-[28px]/none text-heading tracking-[-0.02em]">{fmtG(Number(sentTo.amount))} G$</span>
            <span className="text-sm/[145%] text-nav-muted">sent to <span className="text-heading">{sentTo.label}</span></span>
          </div>
          <div className="w-full flex flex-col gap-2.5">
            <button className={BTN} onClick={onClose}>Done</button>
            <button onClick={reset} className="h-10 text-sm/none text-brand cursor-pointer hover:underline">Send more</button>
          </div>
        </div>
      ) : status === "pending" || (status === "checking" && txHash) ? (
        <div className="flex flex-col items-center text-center gap-5 pt-1" role="status">
          <span className="w-12 h-12 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Loader2 className={`w-6 h-6 ${status === "checking" ? "animate-spin" : ""}`} />
          </span>
          <div className="flex flex-col gap-1.5">
            <p className="text-base/[130%] text-heading">Still on its way</p>
            <p className="text-sm/[150%] text-nav-muted max-w-[300px]">Your G$ was sent, but the network is slow to confirm it. Check again instead of sending a second time.</p>
          </div>
          <button onClick={checkAgain} disabled={status === "checking"} className={BTN}>
            {status === "checking" ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : "Check again"}
          </button>
        </div>
      ) : (
        <>
          {/* Amount: the same big number as the wallet and Withdraw. */}
          <div className="flex flex-col items-center gap-3 pt-1">
            <label htmlFor="send-amount" className="text-sm/none text-nav-muted">You send</label>
            <BigAmountInput id="send-amount" value={amount} display={groupDigits(amount)} disabled={sending}
              onChange={(v) => { setAmount(cleanAmount(v.replace(/,/g, ""))); if (err) setErr(""); }} />
            <div className="flex flex-col items-center gap-2.5">
              <span className="text-[13px]/none text-nav-muted">Balance {formatG$(balance)} G$</span>
              <div className="flex items-center gap-2">
                <button type="button" className={CHIP} disabled={sending} onClick={() => setFraction(0.25)}>25%</button>
                <button type="button" className={CHIP} disabled={sending} onClick={() => setFraction(0.5)}>50%</button>
                <button type="button" className={`${CHIP} !bg-brand-soft !text-brand`} disabled={sending} onClick={() => setFraction(1)}>Max</button>
              </div>
            </div>
            {amountErr && <p className="text-sm/[145%] text-danger">{amountErr}</p>}
          </div>

          {/* Recipient: a username or an address, resolved before sending. */}
          <div className="flex flex-col gap-2.5">
            <label htmlFor="send-to" className="text-sm/none text-nav-muted">To</label>
            <div className="relative">
              {/^0x/i.test(to.trim())
                ? <Wallet className="w-4 h-4 text-nav-muted absolute left-5 top-1/2 -translate-y-1/2" />
                : <AtSign className="w-4 h-4 text-nav-muted absolute left-5 top-1/2 -translate-y-1/2" />}
              <input
                id="send-to"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Username or wallet address"
                value={to}
                disabled={sending}
                onChange={(e) => { setTo(e.target.value); if (err) setErr(""); }}
                className="w-full border border-line h-12 pl-11 pr-24 text-[15px]/none rounded-full placeholder:text-nav-muted text-heading outline-none focus:border-brand transition-colors disabled:opacity-60"
              />
              <button type="button" onClick={paste} disabled={sending}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 px-3.5 rounded-full bg-surface text-[13px]/none text-heading flex items-center gap-1.5 cursor-pointer hover:bg-[#ECECEC] transition-[transform,background-color] duration-150 active:scale-[0.95]">
                <Clipboard className="w-3.5 h-3.5" /> Paste
              </button>
            </div>
            <RecipientCard recipient={recipient} />
          </div>

          {err && <p role="status" className="text-sm/[145%] text-danger -mt-1 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{err}</p>}

          <div className="flex flex-col gap-3">
            <button onClick={handleSend} disabled={!ready} className={BTN}>
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}
              {sending ? "Sending…" : amountNum > 0 ? `Send ${fmtG(amountNum)} G$` : "Send G$"}
            </button>
            <p className="text-center text-xs/[145%] text-nav-muted">Arrives in seconds. Sends can&apos;t be undone.</p>
          </div>
        </>
      )}
    </div>
  );
}

/** Who the G$ is going to, shown before the button goes live. */
function RecipientCard({ recipient }: { recipient: Recipient }) {
  const found = recipient.state === "found" ? recipient : null;
  const profile = useProfile(found?.address);
  if (recipient.state === "empty") return null;
  if (recipient.state === "error") return <p className="text-sm/[145%] text-danger px-1">{recipient.message}</p>;
  if (recipient.state === "looking") {
    return (
      <div className="rounded-2xl border border-line px-4 py-3 flex items-center gap-3" aria-busy="true">
        <span className="w-9 h-9 rounded-full bg-surface animate-pulse" />
        <span className="h-4 w-32 rounded-full bg-surface animate-pulse" />
      </div>
    );
  }
  const name = found!.username ?? profile?.username;
  return (
    <div className="rounded-2xl border border-brand bg-brand-soft/40 px-4 py-3 flex items-center gap-3">
      <Avatar address={found!.address} username={name} preset={profile?.avatar} size={36} ringColor="transparent" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px]/[125%] text-heading truncate">{name ? `@${name}` : "Wallet"}</p>
        <p className="text-xs/[130%] text-nav-muted">{shortAddr(found!.address)}</p>
      </div>
      <span className="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center shrink-0"><Check className="w-3 h-3" strokeWidth={3} /></span>
    </div>
  );
}

export default SendGModal;
