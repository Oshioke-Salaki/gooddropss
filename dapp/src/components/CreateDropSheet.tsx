"use client";
import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits, maxUint256 } from "viem";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS,
  GOOD_DROPS_ABI,
  G_TOKEN_ADDRESS,
  ERC20_ABI,
} from "@/lib/contracts";
import {
  degToGps, formatG$,
  buildPrivateHint, buildPrivateHintNoTarget,
} from "@/lib/utils";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Share2, Lock } from "lucide-react";
import { decodeEventLog } from "viem";
import clsx from "clsx";

const DURATIONS = [
  { label: "1h",  seconds: 3_600 },
  { label: "6h",  seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
  { label: "7d",  seconds: 604_800 },
  { label: "30d", seconds: 2_592_000 },
];

type Status = "idle" | "approving" | "dropping" | "done" | "error";

interface Props {
  open: boolean;
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateDropSheet({ open, userLocation, onClose, onSuccess }: Props) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { balance, isFetching: balanceFetching } = useGoodDollarProfile();

  // ── Location (set via picker) ───────────────────────────────────────────────
  const [lat, setLat]           = useState<number | null>(null);
  const [lng, setLng]           = useState<number | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Form fields ────────────────────────────────────────────────────────────
  const [amount,        setAmount]        = useState("10");
  const [duration,      setDuration]      = useState(86_400);
  const [hint,          setHint]          = useState("");
  const [status,        setStatus]        = useState<Status>("idle");
  const [errMsg,        setErrMsg]        = useState("");
  // ── Private drop ────────────────────────────────────────────────────────────
  const [isPrivate,     setIsPrivate]     = useState(false);
  const [targetAddress, setTargetAddress] = useState("");
  const [createdDropId, setCreatedDropId] = useState<bigint | null>(null);
  const [linkCopied,    setLinkCopied]    = useState(false);

  const reset = useCallback(() => {
    setStatus("idle");
    setErrMsg("");
    setHint("");
    setAmount("10");
    setDuration(86_400);
    setLat(null);
    setLng(null);
    setPlaceName(null);
    setIsPrivate(false);
    setTargetAddress("");
    setCreatedDropId(null);
    setLinkCopied(false);
  }, []);

  const handleClose = () => { reset(); onClose(); };

  // ── Location picker confirmed ───────────────────────────────────────────────
  function handleLocationConfirm(pickedLat: number, pickedLng: number, name: string | null) {
    setLat(pickedLat);
    setLng(pickedLng);
    setPlaceName(name);
    setPickerOpen(false);
  }

  // ── On-chain drop ───────────────────────────────────────────────────────────
  async function handleDrop() {
    if (!address || lat === null || lng === null) return;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) { setErrMsg("Enter a valid amount."); return; }
    if (hint.length > 200) { setErrMsg("Hint is too long (max 200 chars)."); return; }

    const amountBig = parseUnits(amount, 18);
    if (amountBig > balance) {
      setErrMsg(`Insufficient balance — you have ${formatG$(balance)} G$, need ${formatG$(amountBig)} G$.`);
      return;
    }
    const expiry = Math.floor(Date.now() / 1000) + duration + 120;

    // Build the stored hint: prepend private encoding if needed
    const storedHint = isPrivate
      ? (targetAddress.trim()
          ? buildPrivateHint(hint, targetAddress.trim())
          : buildPrivateHintNoTarget(hint))
      : hint;

    try {
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
        args: [address, GOOD_DROPS_ADDRESS],
      });
      if (allowance < amountBig) {
        setStatus("approving");
        const approveTx = await writeContractAsync({
          address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [GOOD_DROPS_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }
      setStatus("dropping");
      const dropTx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
        args: [degToGps(lat), degToGps(lng), amountBig as bigint, expiry, storedHint],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: dropTx });

      // Extract the created drop ID from the DropCreated event log
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi:       GOOD_DROPS_ABI,
            data:      log.data,
            topics:    log.topics,
            eventName: "DropCreated",
          });
          if (decoded.args.dropId !== undefined) {
            setCreatedDropId(decoded.args.dropId as bigint);
            break;
          }
        } catch { /* not this log */ }
      }

      setStatus("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong — try again.");
      setStatus("error");
    }
  }

  function handleShare() {
    const loc = placeName ? `near ${placeName}` : "at a secret spot";
    const text = `I just hid ${amount} G$ ${loc} 🎯\n\nCan you find it? Hunt it down on GoodDrops 💰\n\n#GoodDollar #GoodDrops #Web3`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      "_blank", "noopener,noreferrer"
    );
  }

  const busy = status === "approving" || status === "dropping";
  const amountNum = parseFloat(amount);
  const amountWei = !isNaN(amountNum) && amountNum > 0
    ? parseUnits(amount, 18)
    : 0n;
  const insufficientBalance = isConnected && !balanceFetching && amountWei > 0n && amountWei > balance;
  // Private prefix overhead: "[P:0x1234567890abcdef1234567890abcdef12345678]" = 46 chars
  const hintMaxLen = isPrivate ? 154 : 200;
  const canDrop =
    isConnected && lat !== null && lng !== null &&
    !isNaN(amountNum) && amountNum > 0 && hint.length <= hintMaxLen && !busy && !insufficientBalance;

  const btnLabel =
    status === "approving" ? "One moment…" :
    status === "dropping"  ? "Hiding…" :
    status === "error"     ? "Try again" :
    `Drop ${amount || "?"} G$`;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        animate={{ opacity: open && !pickerOpen ? 1 : 0, pointerEvents: open && !pickerOpen ? "auto" : "none" }}
        transition={{ duration: 0.2 }}
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1002,
          backgroundColor: "rgba(17,17,17,0.55)",
          backdropFilter: "blur(2px)",
          opacity: 0, pointerEvents: "none",
        }}
      />

      {/* Sheet */}
      <motion.div
        animate={{ y: open ? 0 : "100%" }}
        initial={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 420 }}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1003,
          borderRadius: "24px 24px 0 0",
          background: "#f5f4f0",
          borderTop: "2px solid #111",
          maxHeight: "92dvh",
          overflowY: "auto",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#888" }} />
        </div>

        <div className="px-5 pb-10 pt-2 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight">Drop G$</h2>
              <p className="text-sm text-muted mt-0.5">Hide money anywhere in the world</p>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full border-2 border-ink flex items-center justify-center font-bold text-sm hover:bg-ink hover:text-lime transition-colors"
            >✕</button>
          </div>

          {/* Success state */}
          {status === "done" && (() => {
            const shareUrl = createdDropId !== null
              ? `${typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz"}/drop/${createdDropId}`
              : null;
            return (
              <div className="space-y-4">
                <div className="bg-lime border-2 border-ink rounded-xl p-5 text-center space-y-3">
                  <div className="text-5xl">🎉</div>
                  <p className="font-black text-xl">Drop created!</p>
                  <p className="text-sm text-ink/70">
                    {amount} G$ hidden{placeName ? ` in ${placeName}` : ""}. Time to hunt!
                  </p>
                  <button
                    onClick={handleShare}
                    className="btn-brutal w-full bg-ink text-lime font-bold py-3 rounded-xl flex items-center justify-center gap-2"
                  >
                    <span>Post on 𝕏</span><span>↗</span>
                  </button>
                </div>

                {/* Invitation link card — shown for all drops */}
                {shareUrl && (
                  <div className="bg-card border-2 border-ink rounded-xl p-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted">
                      {isPrivate ? "📫 Invitation link" : "🔗 Drop link"}
                    </p>
                    <p className="text-xs text-muted leading-relaxed">
                      {isPrivate
                        ? "Share this privately — only people with this link can find the drop."
                        : "Anyone with this link goes directly to this drop."}
                    </p>

                    {/* URL row */}
                    <div className="flex items-center gap-2 bg-cream border border-ink rounded-lg px-3 py-2 min-w-0">
                      <span className="text-xs font-mono text-muted truncate flex-1 min-w-0">
                        {shareUrl}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(shareUrl).then(() => {
                            setLinkCopied(true);
                            setTimeout(() => setLinkCopied(false), 2000);
                          });
                        }}
                        className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 bg-ink text-lime rounded-md"
                      >
                        {linkCopied ? <Check size={12} /> : <Copy size={12} />}
                        {linkCopied ? "Copied" : "Copy"}
                      </button>
                    </div>

                    {/* QR code */}
                    <div className="flex justify-center pt-1">
                      <div className="border-2 border-ink rounded-xl p-3 bg-white inline-block">
                        <QRCodeSVG value={shareUrl} size={140} level="M" includeMargin={false} />
                      </div>
                    </div>

                    {typeof navigator !== "undefined" && "share" in navigator && (
                      <button
                        onClick={() => navigator.share?.({ title: "GoodDrops — hidden G$", url: shareUrl })}
                        className="btn-brutal w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-cream border-2 border-ink"
                      >
                        <Share2 size={14} />
                        Share invitation
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={() => { onSuccess(); reset(); }}
                  className="w-full py-2.5 rounded-xl font-bold text-sm text-ink/60 hover:text-ink transition-colors"
                >
                  Done
                </button>
              </div>
            );
          })()}

          {status !== "done" && (
            <>
              {/* ── Location picker row ────────────────────────────────────── */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted">
                  Drop location
                </label>

                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full text-left"
                >
                  {lat !== null && lng !== null ? (
                    /* Location chosen */
                    <div className="flex items-center gap-3 bg-lime border-2 border-ink rounded-xl px-4 py-3 shadow-brutal-sm">
                      <span className="text-xl shrink-0">📍</span>
                      <div className="flex-1 min-w-0">
                        {placeName && (
                          <p className="font-black text-sm leading-tight truncate">{placeName}</p>
                        )}
                        <p className="text-xs text-ink/60 font-mono mt-0.5">
                          {lat.toFixed(5)}°, {lng.toFixed(5)}°
                        </p>
                      </div>
                      <span className="text-xs font-bold text-ink/50 shrink-0">Change →</span>
                    </div>
                  ) : (
                    /* No location yet */
                    <div className="flex items-center gap-3 border-2 border-dashed border-ink rounded-xl px-4 py-4 hover:bg-border transition-colors">
                      <div className="w-10 h-10 rounded-full bg-ink flex items-center justify-center shrink-0">
                        <span className="text-lime text-lg">🗺️</span>
                      </div>
                      <div>
                        <p className="font-black text-sm">Choose a location</p>
                        <p className="text-xs text-muted mt-0.5">
                          Search anywhere or pan the map
                        </p>
                      </div>
                      <span className="ml-auto text-xl">→</span>
                    </div>
                  )}
                </button>
              </div>

              {/* ── Amount ───────────────────────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted">Amount</label>
                  {isConnected && !balanceFetching && (
                    <span className={clsx(
                      "text-xs font-semibold",
                      insufficientBalance ? "text-danger" : "text-muted"
                    )}>
                      Balance: {formatG$(balance)} G$
                    </span>
                  )}
                </div>
                <div className={clsx(
                  "flex items-center border-2 rounded-xl overflow-hidden transition-colors",
                  insufficientBalance ? "border-danger" : "border-ink"
                )}>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1" max="500" step="1" placeholder="10"
                    className="flex-1 px-4 py-3 text-xl font-black bg-transparent outline-none"
                  />
                  <div className="pr-4 text-xl font-black text-muted">G$</div>
                </div>
                {insufficientBalance ? (
                  <p className="text-xs text-danger font-semibold">
                    You only have {formatG$(balance)} G$ — reduce the amount.
                  </p>
                ) : (
                  <p className="text-xs text-muted">Min 1 G$ · Max 500 G$</p>
                )}
              </div>

              {/* ── Expiry ───────────────────────────────────────────────────── */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted">Expires in</label>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.seconds}
                      onClick={() => setDuration(d.seconds)}
                      className={clsx(
                        "px-4 py-2 rounded-lg border-2 border-ink text-sm font-bold transition-all",
                        duration === d.seconds ? "bg-lime shadow-brutal-sm" : "bg-cream hover:bg-border"
                      )}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              {/* ── Hint ─────────────────────────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted">Leave a clue</label>
                  <span className={clsx("text-xs font-semibold", hint.length > hintMaxLen - 20 ? "text-danger" : "text-muted")}>
                    {hint.length}/{hintMaxLen}
                  </span>
                </div>
                <textarea
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="e.g. Under the red bench near the fountain 🔍"
                  maxLength={hintMaxLen} rows={3}
                  className="w-full border-2 border-ink rounded-xl px-4 py-3 text-sm bg-transparent outline-none resize-none placeholder:text-muted"
                />
              </div>

              {/* ── Private drop toggle ───────────────────────────────────── */}
              <div className="border-2 border-ink rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsPrivate((p) => !p)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-cream hover:bg-border transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Lock size={15} strokeWidth={2.5} className={isPrivate ? "text-ink" : "text-muted"} />
                    <div className="text-left">
                      <p className={clsx("text-sm font-bold", isPrivate ? "text-ink" : "text-muted")}>
                        Private drop
                      </p>
                      <p className="text-xs text-muted">
                        Hidden from map — share the link to invite someone
                      </p>
                    </div>
                  </div>
                  <div className={clsx(
                    "w-10 h-6 rounded-full border-2 border-ink relative shrink-0 transition-colors",
                    isPrivate ? "bg-lime" : "bg-border"
                  )}>
                    <div className={clsx(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all",
                      isPrivate ? "left-4" : "left-0.5"
                    )} />
                  </div>
                </button>

                {isPrivate && (
                  <div className="px-4 pb-4 pt-3 border-t-2 border-ink bg-cream space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted block">
                      For (address) — optional
                    </label>
                    <input
                      type="text"
                      value={targetAddress}
                      onChange={(e) => setTargetAddress(e.target.value)}
                      placeholder="0x…  leave blank for anyone with the link"
                      className="w-full border-2 border-ink rounded-xl px-4 py-2.5 text-sm bg-white outline-none font-mono placeholder:text-muted placeholder:font-sans"
                    />
                    <p className="text-xs text-muted">
                      The app will warn others this drop wasn&apos;t meant for them.
                    </p>
                  </div>
                )}
              </div>

              {/* ── Error ────────────────────────────────────────────────────── */}
              {(status === "error" || errMsg) && (
                <div className="bg-danger/10 border-2 border-danger rounded-xl px-4 py-3 text-sm text-danger font-semibold">
                  {errMsg || "Something went wrong."}
                </div>
              )}

              {/* ── CTA ──────────────────────────────────────────────────────── */}
              <div className="space-y-2 pt-1">
                {!isConnected ? (
                  <p className="text-center text-sm text-muted font-semibold">
                    Sign in to drop G$
                  </p>
                ) : (
                  <button
                    onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handleDrop}
                    disabled={status !== "error" && !canDrop}
                    className={clsx(
                      "btn-brutal w-full py-4 rounded-xl font-black text-base transition-all",
                      canDrop || status === "error"
                        ? "bg-lime text-ink cursor-pointer"
                        : "bg-border text-muted cursor-not-allowed"
                    )}
                    style={!(canDrop || status === "error") ? { boxShadow: "none", transform: "none" } : {}}
                  >
                    {btnLabel}
                  </button>
                )}
                <p className="text-center text-xs text-muted">
                  Hunters within 100m can claim this drop
                </p>
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* Location picker — slides over the create sheet */}
      <LocationPickerSheet
        open={pickerOpen}
        initialCenter={lat !== null && lng !== null ? { lat, lng } : userLocation}
        onConfirm={handleLocationConfirm}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}
