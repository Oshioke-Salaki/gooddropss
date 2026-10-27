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
} from "lucide-react";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useProfile, invalidateProfile } from "@/hooks/useProfile";
import { Avatar } from "@/components/Avatar";
import { SendGModal } from "@/components/SendGModal";
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

/** Row shell shared by the streak / balance / action rows. */
const ROW =
  "rounded-full py-3 pl-4 pr-6 border border-line flex items-center gap-4";

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
  const [sendOpen, setSendOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { balance } = useGoodDollarProfile();
  const { data: nativeBalance } = useBalance({ address });
  const profile = useProfile(address);
  const router = useRouter();
  const { signMessageAsync } = useSignMessage();

  // ── Hunting streak ────────────────────────────────────────────────────────
  const [streak, setStreak] = useState<{
    current: number;
    best: number;
  } | null>(null);
  const [streakLoading, setStreakLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setStreakLoading(true);
    fetch(`/api/engagement?address=${address}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.streak) setStreak(d.streak);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStreakLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
            <SendGModal
              address={address}
              balance={balance}
              onClose={() => setSendOpen(false)}
            />
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
            rounded-b-3xl lg:rounded-3xl flex-col gap-y-6
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
                  size={46}
                  ringColor="transparent"
                />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-x-2 mb-4">
                  <h3 className="text-lg/[100%] text-heading truncate">
                    {profile?.username ?? shortAddress}
                  </h3>
                  <button
                    onClick={() => setEditing((e) => !e)}
                    title={profile?.username ? "Edit username" : "Set username"}
                    className="shrink-0 text-nav-muted hover:text-heading transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-x-2">
                  <h3 className="text-nav-muted text-sm/[100%] truncate">
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
              className="shrink-0 bg-surface rounded-full text-black w-[46px] h-[46px] flex justify-center items-center cursor-pointer hover:opacity-80 transition-opacity"
            >
              <ArrowRight className="w-6 h-6" />
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

          {/* ── Rows ─────────────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-y-4">
            {streakLoading ? (
              /* Same footprint as the real row, so nothing shifts when it lands. */
              <div className={ROW}>
                <Skeleton className="w-[46px] h-[46px] shrink-0" />
                <div className="flex flex-col gap-y-[14px] min-w-0 flex-1">
                  <Skeleton className="h-[26px] w-[150px]" />
                  <Skeleton className="h-[14px] w-[190px] max-w-full" />
                </div>
              </div>
            ) : (
              <div className={ROW}>
                <div
                  className={`bg-streak-ring w-[46px] h-[46px] rounded-full flex items-center justify-center shrink-0 ${!streak?.current ? "opacity-40" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/streak-flame.svg" className="w-6 h-6" alt="" />
                </div>
                <div className="flex flex-col gap-y-3 min-w-0">
                  <div className="py-[6px] px-3 bg-streak-bg text-sm/[100%] text-streak w-fit rounded-full">
                    {streak?.current
                      ? `${streak.current} day hunting streak`
                      : "No streak yet"}
                  </div>
                  <div className="text-nav-muted text-sm/[100%] truncate">
                    {streak?.current
                      ? `Best: ${streak.best} days · Keep hunting daily!`
                      : "Claim a drop to start your streak"}
                  </div>
                </div>
              </div>
            )}

            <div className={`${ROW} justify-between`}>
              <div className="flex items-center gap-4 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/gdollartoken-logo.svg"
                  alt=""
                  className="w-[46px] h-[46px] shrink-0"
                />
                <div className="flex flex-col gap-y-3 min-w-0">
                  <div className="text-heading text-base/[100%]">
                    G$ Balance
                  </div>
                  <div className="text-nav-muted text-sm/[100%]">
                    Your wallet
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-y-3 text-right shrink-0">
                <div className="text-heading text-base/[100%]">
                  {formatG$(balance)}
                </div>
                <div className="text-nav-muted text-sm/[100%]">G$</div>
              </div>
            </div>

            <div className={`${ROW} justify-between`}>
              <div className="flex items-center gap-4 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/celo-logo.svg"
                  alt=""
                  className="w-[46px] h-[46px] shrink-0"
                />
                <div className="flex flex-col gap-y-3 min-w-0">
                  <div className="text-heading text-base/[100%]">Celo</div>
                  <div className="text-nav-muted text-sm/[100%]">
                    For transaction fees
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-y-3 text-right shrink-0">
                <div className="text-heading text-base/[100%]">{celoAmt}</div>
                <div className="text-nav-muted text-sm/[100%]">CELO</div>
              </div>
            </div>

            <button
              onClick={() => setSendOpen((v) => !v)}
              className={`${ROW} w-full text-left cursor-pointer transition-colors ${sendOpen ? "bg-surface" : "hover:bg-surface"}`}
            >
              <div className="bg-surface w-[46px] h-[46px] rounded-full flex items-center justify-center shrink-0">
                <Send className="w-5 h-5 text-heading" />
              </div>
              <div className="flex flex-col gap-y-3 min-w-0">
                <div className="text-heading text-base/[100%]">Send G$</div>
                <div className="text-nav-muted text-sm/[100%]">
                  Transfer G$ to any wallet
                </div>
              </div>
            </button>
          </div>

          {/* ── Verify nudge — only when they can't yet claim drops ───────────── */}
          {!isVerified && (
            <button
              onClick={() => {
                onOpenVerify();
                onClose();
              }}
              className="w-full bg-streak-bg text-streak py-3 px-6 rounded-full text-sm/[100%] cursor-pointer hover:opacity-90 transition-opacity"
            >
              Verify your account to claim drops
            </button>
          )}

          {/* ── Daily UBI ────────────────────────────────────────────────────── */}
          {isVerified && ubiStatus === "loading" && (
            /* Matches the claim button's footprint (py-3 + 20px icon ⇒ 44px). */
            <Skeleton className="self-center h-11 w-[220px] max-w-full" />
          )}

          {isVerified &&
            ubiStatus !== "loading" &&
            (ubiClaimDone ? (
              <p className="self-center text-sm/[100%] text-nav-muted">
                {ubiEntitlement
                  ? `+${formatG$(ubiEntitlement)} G$ claimed today`
                  : "UBI claimed today"}
              </p>
            ) : ubiStatus === "can_claim" ? (
              <button
                onClick={handleUbiClaim}
                disabled={ubiClaiming}
                className="self-center bg-brand py-3 px-6 rounded-full flex items-center gap-x-2 text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-wait"
              >
                {ubiClaiming ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src="/money-dollar-circle.svg"
                    alt=""
                    className="w-5 h-5"
                  />
                )}
                {ubiClaiming
                  ? "Claiming…"
                  : `Claim daily ${ubiEntitlement ? formatG$(ubiEntitlement) : "G$"} UBI`}
              </button>
            ) : ubiStatus === "already_claimed" ? (
              <p className="self-center text-sm/[100%] text-nav-muted">
                Daily G$ UBI already claimed
              </p>
            ) : null)}
          {ubiErr && (
            <p className="text-xs/[140%] text-danger text-center -mt-3">
              {ubiErr}
            </p>
          )}

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
