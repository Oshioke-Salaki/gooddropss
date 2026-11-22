"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useEscapeLayer, useFocusReturn, useScrollLock } from "@/components/ui/layers";
import { useBalance, useSignMessage } from "wagmi";
import { formatUnits } from "viem";
import {
  Copy,
  Check,
  LogOut,
  Pencil,
  Loader2,
  ArrowRight,
  Send,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useProfile, invalidateProfile } from "@/hooks/useProfile";
import { Avatar } from "@/components/Avatar";
import { SendGModal } from "@/components/SendGModal";
import { CashOutPanel } from "@/components/cashout/CashOutPanel";
import { getWithdrawAvailability, getWithdrawInfo, peekWithdrawInfo } from "@/lib/withdrawInfo";
import { getStreak, peekStreak } from "@/lib/streakCache";
import { useRouter } from "next/navigation";
import { formatG$ } from "@/lib/utils";
import { useUbiClaim } from "@/hooks/useUbiClaim";

interface Props {
  address: `0x${string}`;
  isVerified: boolean;
  onDisconnect: () => void;
  onClose: () => void;
  onOpenVerify: () => void;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

/** Neutral shimmer block. Sized by the caller so skeletons occupy the exact
 *  footprint of the real content — no layout shift when the data lands. */
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-line ${className}`} />;
}

export function WalletModal({
  address,
  isVerified,
  onDisconnect,
  onClose,
  onOpenVerify,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [checkState, setCheckState] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // One side panel at a time: Send G$ or Cash out.
  const [side, setSide] = useState<null | "send" | "cashout">(null);
  const sendOpen = side !== null;
  const setSendOpen = (v: boolean | ((x: boolean) => boolean)) =>
    setSide((cur) => ((typeof v === "function" ? v(cur === "send") : v) ? "send" : null));
  // Withdrawals: on or off, Nigeria only (connection country or Lagos time),
  // and the naira value of the balance (lib/withdrawInfo, asked once per page
  // view). Known answers render at once, so reopening the wallet never pops in.
  const [cashOutOn, setCashOutOn] = useState(() => !!peekWithdrawInfo()?.enabled);
  const [inNigeria, setInNigeria] = useState(() => peekWithdrawInfo()?.inNigeria ?? true);
  const [nairaPerG, setNairaPerG] = useState<number | null>(() => peekWithdrawInfo()?.nairaPerG ?? null);
  useEffect(() => {
    let cancelled = false;
    // Availability first (the Withdraw button), then the rate (the ₦ line).
    getWithdrawAvailability().then((a) => {
      if (cancelled) return;
      setCashOutOn(a.enabled);
      setInNigeria(a.inNigeria);
    });
    getWithdrawInfo().then((i) => { if (!cancelled) setNairaPerG(i.nairaPerG); });
    return () => { cancelled = true; };
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);

  const { balance } = useGoodDollarProfile();
  const { data: nativeBalance } = useBalance({ address });
  const profile = useProfile(address);
  const router = useRouter();
  const { signMessageAsync } = useSignMessage();

  // ── Hunting streak ────────────────────────────────────────────────────────
  // Shared with the nav's streak badge, so reopening the wallet shows it at once.
  const cachedStreak = peekStreak(address);
  const [streak, setStreak] = useState<{ current: number; best: number } | null>(cachedStreak ?? null);
  const [streakLoading, setStreakLoading] = useState(cachedStreak === undefined);
  useEffect(() => {
    let cancelled = false;
    getStreak(address)
      .then((s) => { if (!cancelled) setStreak(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setStreakLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  // ── UBI claim ─────────────────────────────────────────────────────────────
  // Shared with the load-time prompt (UbiPrompt): claiming in either updates both.
  const ubi = useUbiClaim();
  const ubiStatus = ubi.status === "error" ? "not_whitelisted" : ubi.status; // hide the row on a failed read
  const ubiEntitlement = ubi.claimed ?? ubi.entitlement;
  const ubiClaiming = ubi.claiming;
  const ubiClaimDone = ubi.claimed !== null;
  const ubiErr = ubi.error;
  const handleUbiClaim = () => { void ubi.claim(); };

  const celoAmt = nativeBalance
    ? parseFloat(
        formatUnits(nativeBalance.value, nativeBalance.decimals),
      ).toFixed(3)
    : "—";
  const shortAddress = `${address.slice(0, 6)}…${address.slice(-4)}`;
  // The exact balance, whole G$ (two decimals only for small amounts).
  const balG = Number(formatUnits(balance, 18));
  const balanceFull = balG.toLocaleString("en-US", { maximumFractionDigits: balG < 10 ? 2 : 0 });

  // Lifts the mobile send sheet clear of the on-screen keyboard.
  const kbInset = useKeyboardInset(sendOpen);

  // Shared layer plumbing (ui/layers). Escape is the same dismissal the
  // backdrop gives — except while the username editor is open, where it cancels
  // the edit instead. Send G$ registers as its own layer on top, so Escape there
  // closes Send and leaves the wallet open. The page behind stays locked, and
  // focus returns to the nav pill when the wallet closes.
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeLayer(true, () => {
    if (editing) setEditing(false);
    else onClose();
  });
  useScrollLock(true);
  useFocusReturn(true, panelRef);

  // ── Username editing ──────────────────────────────────────────────────────
  useEffect(() => {
    if (editing) {
      setInput(profile?.username ?? "");
      setCheckState("idle");
      setSaveError("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editing, profile?.username]);

  useEffect(() => {
    if (!editing) return;
    const val = input.trim().toLowerCase();
    if (!val) {
      setCheckState("idle");
      return;
    }
    if (!USERNAME_RE.test(val)) {
      setCheckState("invalid");
      return;
    }
    if (val === profile?.username?.toLowerCase()) {
      setCheckState("available");
      return;
    }

    setCheckState("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/profile/check?username=${encodeURIComponent(val)}`,
        );
        const data = await res.json();
        setCheckState(data.available ? "available" : "taken");
      } catch {
        setCheckState("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [input, editing, profile?.username]);

  async function handleSave() {
    const username = input.trim();
    if (checkState !== "available" || !username) return;
    setSaving(true);
    setSaveError("");
    try {
      const timestamp = Date.now();
      const message = `GoodDrops: claim username "${username}" at ${timestamp}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, username, signature, timestamp }),
      });
      const data = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        setSaveError(
          (data as { error?: string }).error ??
            "Couldn't save that name. Try again.",
        );
        return;
      }

      invalidateProfile(address);
      await fetch(`/api/profile?address=${address.toLowerCase()}`);
      setEditing(false);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setSaveError(err.shortMessage ?? err.message ?? "Cancelled");
    } finally {
      setSaving(false);
    }
  }

  function copyAddress() {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const checkText = {
    idle: "",
    checking: "Checking…",
    available: "Available",
    taken: "Already taken",
    invalid: "3–24 chars, letters/numbers/_/-",
  }[checkState];
  const checkTone =
    checkState === "available"
      ? "text-streak"
      : checkState === "taken" || checkState === "invalid"
        ? "text-danger"
        : "text-nav-muted";

  // Guard for a server render: every hook above has already run, so this early
  // return is safe. In practice the modal only mounts after a click.
  if (typeof document === "undefined") return null;

  // Portalled to <body>. This component is rendered from inside <nav>, which is a
  // z-1100 stacking context — so nested z-indexes like 1190/1200 were being
  // flattened to 1100, leaving the backdrop (and the panels) beneath anything on
  // the page above 1100. Clicks outside then landed on that content instead of
  // the backdrop, and the modal stayed open. At <body> level the values are real.
  return createPortal(
    <>
      {/* Backdrop — one tap anywhere outside the panels closes everything. It
          covers the trigger button too, so that tap closes rather than re-toggling. */}
      <div className="modal-fade-in fixed inset-0 z-[1190]" onClick={onClose} />

      {/* Below lg: one full-bleed sheet flush under the nav, capped to the space
          below it so a long panel scrolls instead of running off-screen — the
          container keeps its content height, so taps below it still reach the
          backdrop. At lg and up: the two 400px cards, Send G$ to the LEFT. */}
      <div
        className="fixed z-[1200] left-0 right-0 top-nav flex flex-col
          max-h-[calc(100dvh-var(--spacing-nav))] overflow-y-auto overflow-x-hidden font-sans
          lg:left-auto lg:right-15 lg:top-[calc(var(--spacing-nav)+16px)]
          lg:flex-row lg:items-start lg:gap-4 lg:max-h-none lg:overflow-visible"
      >
        {/* Send G$. Below lg it breaks out of this container into a bottom sheet
            (`fixed` takes a flex child out of flow); `lg:static` drops it right
            back into the row beside the wallet card. `bottom` rides the keyboard
            inset so the amount field is never buried — ignored at lg, where the
            element is `static`. */}
        {sendOpen && (
          <div
            className="fixed inset-x-0 bottom-0 w-full
              lg:static lg:w-[400px] lg:max-w-[calc(100vw-24px)]"
            style={{ bottom: kbInset, transition: "bottom 0.12s ease-out" }}
          >
            {side === "cashout" ? (
              <CashOutPanel
                address={address}
                balance={balance}
                available={inNigeria}
                onSend={() => setSide("send")}
                onClose={() => setSide(null)}
              />
            ) : (
              <SendGModal
                address={address}
                balance={balance}
                onClose={() => setSide(null)}
              />
            )}
          </div>
        )}

        {/* On a phone Send G$ takes the whole sheet rather than stacking — there's
            no room for two cards, and the wallet is one tap away behind it. */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Wallet"
          tabIndex={-1}
          className={`outline-none panel-in w-full lg:w-[400px] lg:max-w-[calc(100vw-24px)] bg-white p-6
            rounded-b-3xl lg:rounded-3xl flex-col gap-y-5
            ${sendOpen ? "hidden lg:flex" : "flex"}`}
          style={{ boxShadow: "0px 0px 12px 0px #0000000A" }}
        >
          {/* ── Identity ─────────────────────────────────────────────────────── */}
          <div className="flex justify-between items-center gap-3">
            <div className="flex gap-x-4 items-center min-w-0">
              {/* Avatar — tap to pick a preset vibe */}
              <button
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("gd:editAvatar"))
                }
                title="Change your avatar"
                className="shrink-0 leading-none cursor-pointer rounded-full"
              >
                <Avatar
                  address={address}
                  username={profile?.username}
                  preset={profile?.avatar}
                  size={44}
                  ringColor="transparent"
                />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-x-2 mb-2">
                  {profile === undefined ? (
                    <Skeleton className="h-4 w-28" />
                  ) : profile?.username ? (
                    <h3 className="text-base/[120%] text-heading truncate">{profile.username}</h3>
                  ) : (
                    <button type="button" onClick={() => setEditing(true)} className="text-base/[120%] text-nav-muted truncate cursor-pointer hover:text-heading">
                      Add a username
                    </button>
                  )}
                  <button
                    onClick={() => setEditing((e) => !e)}
                    title={profile?.username ? "Edit username" : "Set username"}
                    className="shrink-0 text-nav-muted hover:text-heading transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-x-2">
                  <h3 className="text-nav-muted text-[13px]/[100%] truncate">
                    {shortAddress}
                  </h3>
                  <button
                    onClick={copyAddress}
                    title="Copy address"
                    aria-label="Copy wallet address"
                    className="shrink-0 text-nav-muted hover:text-heading transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-streak" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Go to your profile page. Closes the wallet first so the two never
                stack — the page is the fuller view of the same person. */}
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push("/me");
              }}
              title="View my profile"
              aria-label="View my profile"
              className="shrink-0 bg-surface rounded-full text-black w-10 h-10 flex justify-center items-center cursor-pointer hover:bg-[#ECECEC] transition-[transform,background-color] duration-150 active:scale-[0.94]"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          {/* ── Username edit form ───────────────────────────────────────────── */}
          {editing && (
            <div className="flex flex-col gap-y-3 -mt-2">
              <div className="relative">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  placeholder="yourname"
                  maxLength={24}
                  disabled={saving}
                  className="w-full border border-line py-4 px-6 text-sm/[100%] rounded-full placeholder:text-nav-muted text-black outline-none focus:border-brand transition-colors disabled:opacity-60"
                />
                {checkState === "checking" && (
                  <Loader2 className="w-4 h-4 animate-spin text-nav-muted absolute top-1/2 right-6 -translate-y-1/2" />
                )}
              </div>
              {checkText && (
                <p className={`text-xs/[100%] ${checkTone}`}>{checkText}</p>
              )}
              {saveError && (
                <p className="text-xs/[140%] text-danger">{saveError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={checkState !== "available" || saving}
                  className="flex-1 bg-brand text-white py-3 px-6 rounded-full text-sm/[100%] flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {saving ? "Saving…" : "Save name"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="bg-surface text-heading py-3 px-6 rounded-full text-sm/[100%] cursor-pointer hover:opacity-80 transition-opacity"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Balance: the one number people open this for ───────────────── */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm/none text-nav-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/gdollartoken-logo.svg" alt="" className="w-5 h-5" />
                G$ balance
              </span>
              {streakLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <span
                  title={streak?.current ? `Best: ${streak.best} days` : "Claim a drop to start your streak"}
                  className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs/none ${streak?.current ? "bg-streak-bg text-streak" : "bg-surface text-nav-muted"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/streak-flame.svg" alt="" className={`w-3.5 h-3.5 ${streak?.current ? "" : "opacity-40 grayscale"}`} />
                  {streak?.current ? `${streak.current}-day streak` : "No streak yet"}
                </span>
              )}
            </div>
            <div className="mt-3 flex items-baseline gap-2 min-w-0">
              <span className="text-[34px]/none text-heading tracking-[-0.02em] tabular-nums truncate">{balanceFull}</span>
              <span className="text-base/none text-nav-muted shrink-0">G$</span>
            </div>
            {cashOutOn && inNigeria && nairaPerG !== null && balG > 0 && (
              <p className="mt-2.5 text-sm/none text-nav-muted tabular-nums">
                ≈ ₦{Math.floor(balG * nairaPerG).toLocaleString("en-NG")} if you withdraw
              </p>
            )}
          </div>

          {/* ── Actions ──────────────────────────────────────────────────────── */}
          <div className={`grid gap-2 ${cashOutOn ? "grid-cols-2" : "grid-cols-1"}`}>
            <button
              onClick={() => setSendOpen((v) => !v)}
              aria-pressed={side === "send"}
              className={`h-12 rounded-full flex items-center justify-center gap-2 text-[15px]/none text-heading cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.97] ${side === "send" ? "bg-[#E6E6E6]" : "bg-surface hover:bg-[#ECECEC]"}`}
            >
              <Send className="w-4 h-4" />
              Send
            </button>
            {cashOutOn && (
              <button
                onClick={() => setSide((v) => (v === "cashout" ? null : "cashout"))}
                aria-pressed={side === "cashout"}
                className={`h-12 rounded-full flex items-center justify-center gap-2 text-[15px]/none text-white cursor-pointer transition-[transform,background-color] duration-150 active:scale-[0.97] ${side === "cashout" ? "bg-brand/85" : "bg-brand hover:bg-brand/90"}`}
              >
                <Landmark className="w-4 h-4" />
                Withdraw
              </button>
            )}
          </div>

          {/* ── Details: hairline rows, no boxes ─────────────────────────────── */}
          <div className="border-t border-line divide-y divide-line -mb-2">
            {!isVerified && (
              <div className="flex items-center gap-3 py-3.5">
                <span className="w-9 h-9 rounded-full bg-streak-bg flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-[18px] h-[18px] text-streak" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px]/[130%] text-heading">Verify your account</div>
                  <div className="text-xs/[140%] text-nav-muted">Needed to claim drops</div>
                </div>
                <button
                  onClick={() => { onOpenVerify(); onClose(); }}
                  className="shrink-0 h-9 px-4 rounded-full bg-streak-bg text-streak text-sm/none cursor-pointer hover:opacity-90 transition-[opacity,transform] duration-150 active:scale-[0.96]"
                >
                  Verify
                </button>
              </div>
            )}

            {isVerified && ubiStatus !== "not_whitelisted" && (
              <div className="flex items-center gap-3 py-3.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/gdollartoken-logo.svg" alt="" className="w-9 h-9 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px]/[130%] text-heading">Daily UBI</div>
                  <div className="text-xs/[140%] text-nav-muted">Free G$, every day</div>
                </div>
                {ubiStatus === "loading" ? (
                  <Skeleton className="h-9 w-28 shrink-0" />
                ) : ubiClaimDone ? (
                  <span className="shrink-0 text-sm/none text-nav-muted">
                    {ubiEntitlement ? `+${formatG$(ubiEntitlement)} G$ today` : "Claimed today"}
                  </span>
                ) : ubiStatus === "can_claim" ? (
                  <button
                    onClick={handleUbiClaim}
                    disabled={ubiClaiming}
                    className="shrink-0 h-9 px-4 rounded-full bg-brand-soft text-brand text-sm/none flex items-center gap-1.5 cursor-pointer hover:opacity-90 transition-[opacity,transform] duration-150 active:scale-[0.96] disabled:opacity-60 disabled:cursor-wait"
                  >
                    {ubiClaiming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {ubiClaiming ? "Claiming…" : `Claim ${ubiEntitlement ? formatG$(ubiEntitlement) + " G$" : ""}`.trim()}
                  </button>
                ) : (
                  <span className="shrink-0 text-sm/none text-nav-muted">Claimed today</span>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 py-3.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/celo-logo.svg" alt="" className="w-9 h-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px]/[130%] text-heading">CELO</div>
                <div className="text-xs/[140%] text-nav-muted">Covers tiny sending costs</div>
              </div>
              <span className="shrink-0 text-[15px]/none text-heading tabular-nums">{celoAmt}</span>
            </div>
          </div>
          {ubiErr && <p className="text-xs/[140%] text-danger -mt-3">{ubiErr}</p>}

          {/* ── Sign out ─────────────────────────────────────────────────────── */}
          <button
            onClick={() => {
              onDisconnect();
              onClose();
            }}
            className="self-center flex items-center gap-2 text-sm/[100%] text-nav-muted hover:text-danger transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
