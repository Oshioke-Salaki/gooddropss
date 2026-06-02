"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAccount, useWriteContract } from "wagmi";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import {
  haversineDistance,
  formatG$,
  timeLeft,
  gpsToDeg,
  getDropRarity,
  RARITY,
  isFlashDrop,
  openGoogleMapsWalking,
} from "@/lib/utils";
import { DropComments } from "@/components/DropComments";
import { UserHandle } from "@/components/UserHandle";
import { DROP_STATUS, type Drop, type LatLng } from "@/types";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { Crosshair } from "lucide-react";
import clsx from "clsx";

type Status = "idle" | "claiming" | "done" | "error";

interface Props {
  drop: Drop | null;
  userLocation: LatLng | null;
  onClose: () => void;
  onSuccess: () => void;
  onHunt?: (drop: Drop) => void;
}

export function ClaimSheet({ drop, userLocation, onClose, onSuccess, onHunt }: Props) {
  const { address, isConnected } = useAccount();
  const { isVerified } = useGoodDollarProfile();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState("");

  const open = drop !== null;

  // Reset when a new drop is selected
  useEffect(() => {
    setStatus("idle");
    setErrMsg("");
  }, [drop?.id]);

  const dropLat = drop ? gpsToDeg(drop.lat) : 0;
  const dropLng = drop ? gpsToDeg(drop.lng) : 0;

  const distance =
    drop && userLocation != null
      ? haversineDistance(userLocation.lat, userLocation.lng, dropLat, dropLng)
      : null;

  const isExpired = drop ? drop.expiry < Math.floor(Date.now() / 1000) : false;
  const isActive = drop ? drop.status === DROP_STATUS.Active && !isExpired : false;
  const isSelfDrop = drop ? address?.toLowerCase() === drop.dropper.toLowerCase() : false;
  const isClose = distance !== null && distance <= CLAIM_RADIUS_M;

  const canClaim =
    isConnected &&
    isVerified &&
    isActive &&
    !isSelfDrop &&
    isClose &&
    status === "idle";

  function proximityLabel() {
    if (!userLocation) return { text: "Enable GPS to claim", color: "text-muted" };
    if (distance === null) return { text: "Calculating distance…", color: "text-muted" };
    if (distance <= CLAIM_RADIUS_M)
      return { text: `You're here! ${Math.round(distance)}m away`, color: "text-lime bg-ink px-2 py-0.5 rounded" };
    if (distance <= 500)
      return { text: `Getting closer… ${Math.round(distance)}m away`, color: "text-ink font-bold" };
    return { text: `${Math.round(distance)}m away — move closer`, color: "text-muted" };
  }

  const prox = proximityLabel();
  const proximityPct =
    distance !== null ? Math.max(0, Math.min(100, (1 - distance / 500) * 100)) : 0;

  async function handleClaim() {
    if (!canClaim || !drop) return;
    setStatus("claiming");
    setErrMsg("");
    try {
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "claim",
        args: [drop.id],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong — try again.");
      setStatus("error");
    }
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        animate={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1002,
          backgroundColor: "rgba(17,17,17,0.55)",
          backdropFilter: "blur(2px)",
          opacity: 0,
          pointerEvents: "none",
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
          borderTop: "2px solid #111111",
          maxHeight: "80dvh",
          overflowY: "auto",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#888" }} />
        </div>

        {drop && (
          <div className="px-5 pb-10 pt-2 space-y-5">
            {/* Amount header */}
            <div className="flex items-start justify-between">
              <div>
                {/* Rarity + flash badges */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                  {(() => {
                    const r = RARITY[getDropRarity(drop.amount)];
                    return (
                      <span style={{
                        background: r.color, color: r.textColor,
                        fontSize: 10, fontWeight: 900,
                        padding: "2px 8px", borderRadius: 100,
                        letterSpacing: "0.08em", textTransform: "uppercase",
                      }}>
                        {r.label}
                      </span>
                    );
                  })()}
                  {isFlashDrop(drop) && (
                    <span style={{
                      background: "#FF6400", color: "#fff",
                      fontSize: 10, fontWeight: 900,
                      padding: "2px 8px", borderRadius: 100,
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      animation: "pin-flash 0.8s ease-in-out infinite",
                    }}>
                      ⚡ Flash Drop
                    </span>
                  )}
                </div>
                <div className="text-4xl font-black tracking-tight">
                  <span className="text-ink">{formatG$(drop.amount)}</span>
                  <span className="text-lime"> G$</span>
                </div>
                <div className="mt-1 text-sm text-muted font-medium">
                  {isActive ? (
                    <span className="text-ink">⏰ {timeLeft(drop.expiry)}</span>
                  ) : drop.status === DROP_STATUS.Claimed ? (
                    <span className="text-muted">Claimed ✓</span>
                  ) : (
                    <span className="text-danger">Expired</span>
                  )}
                  <span className="mx-2 text-border">·</span>
                  <span>by <UserHandle address={drop.dropper} /></span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full border-2 border-ink flex items-center justify-center font-bold text-sm hover:bg-ink hover:text-lime transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Hint card */}
            {drop.hint && (
              <div className="border-2 border-dashed border-ink rounded-xl p-4 space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">🔍 Clue</p>
                <p className="text-sm font-semibold leading-relaxed">{drop.hint}</p>
              </div>
            )}

            {/* Walking directions button */}
            {isActive && (
              <button
                onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
                className="btn-brutal flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border-2 border-ink text-sm font-bold bg-cream hover:bg-border transition-colors"
              >
                <Crosshair size={14} />
                Open in Google Maps
              </button>
            )}

            {/* Success */}
            {status === "done" && (
              <div className="bg-lime border-2 border-ink rounded-xl p-5 text-center space-y-3">
                <div className="text-5xl">🎯</div>
                <p className="font-black text-xl">You found it!</p>
                <p className="text-sm text-ink/70">
                  {formatG$(drop.amount)} G$ is yours!
                </p>
                <button
                  onClick={() => {
                    const text = `I just found a hidden drop of ${formatG$(drop.amount)} G$ in the wild 🎯💰\n\nGoodDrops lets you hide and hunt real money IRL!\n\n#GoodDollar #GoodDrops #Web3`;
                    window.open(
                      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
                      "_blank",
                      "noopener,noreferrer"
                    );
                  }}
                  className="btn-brutal w-full bg-ink text-lime font-bold py-3 rounded-xl flex items-center justify-center gap-2"
                >
                  <span>Post on 𝕏</span>
                  <span>↗</span>
                </button>
                <button
                  onClick={onSuccess}
                  className="w-full py-2 rounded-xl font-bold text-sm text-ink/60 hover:text-ink transition-colors"
                >
                  Done
                </button>
              </div>
            )}

            {status !== "done" && isActive && (
              <>
                {/* Proximity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold">📍 Proximity</span>
                    <span className={clsx("font-semibold", prox.color)}>{prox.text}</span>
                  </div>
                  <div className="h-2 bg-border rounded-full overflow-hidden border border-ink">
                    <motion.div
                      className={clsx("h-full rounded-full", isClose ? "bg-lime" : "bg-muted")}
                      animate={{ width: `${proximityPct}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>Far</span>
                    <span className="font-bold text-ink">← need to be within {CLAIM_RADIUS_M}m</span>
                    <span>Here!</span>
                  </div>
                </div>

                {/* Self-drop warning */}
                {isSelfDrop && (
                  <div className="text-sm text-muted font-semibold text-center">
                    This is your own drop — you can&apos;t claim it.
                  </div>
                )}

                {/* Error */}
                {status === "error" && errMsg && (
                  <div className="bg-danger/10 border-2 border-danger rounded-xl px-4 py-3 text-sm text-danger font-semibold">
                    {errMsg}
                  </div>
                )}

                {/* Claim button */}
                <button
                  onClick={status === "error" ? () => setStatus("idle") : handleClaim}
                  disabled={status !== "error" && !canClaim}
                  className={clsx(
                    "btn-brutal w-full py-4 rounded-xl font-black text-base transition-all",
                    canClaim || status === "error"
                      ? "bg-lime text-ink cursor-pointer"
                      : "bg-border text-muted cursor-not-allowed shadow-none border-muted"
                  )}
                  style={!(canClaim || status === "error") ? { boxShadow: "none", transform: "none" } : {}}
                >
                  {status === "claiming"
                    ? "Claiming…"
                    : status === "error"
                    ? "Try again"
                    : !isConnected
                    ? "Sign in to claim"
                    : !isVerified
                    ? "Verification required"
                    : isSelfDrop
                    ? "Can't claim own drop"
                    : !userLocation
                    ? "Enable GPS to claim"
                    : !isClose
                    ? `Get closer (${Math.round(distance ?? 0)}m away)`
                    : `Claim ${formatG$(drop.amount)} G$`}
                </button>

                <p className="text-center text-xs text-muted">
                  Verification required to claim
                </p>

                {/* Hunt button — shown when active but too far to claim */}
                {onHunt && isActive && !isClose && (
                  <button
                    onClick={() => { onClose(); onHunt(drop); }}
                    className="btn-brutal w-full py-3 rounded-xl font-bold text-sm bg-ink text-lime flex items-center justify-center gap-2 mt-2"
                  >
                    <Crosshair size={16} />
                    Hunt this drop
                  </button>
                )}
              </>
            )}

            {/* Flash drop countdown */}
            {isActive && isFlashDrop(drop) && (
              <div style={{
                background: "#FF640015",
                border: "1.5px solid #FF640044",
                borderRadius: 10,
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{ fontSize: 16 }}>⚡</span>
                <div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "#FF6400" }}>
                    Flash Drop — {timeLeft(drop.expiry)} left!
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>
                    This drop expires very soon — hurry!
                  </p>
                </div>
              </div>
            )}

            {/* Inactive state */}
            {!isActive && status !== "done" && (
              <div className="text-center py-4 text-muted font-semibold">
                {drop.status === DROP_STATUS.Claimed
                  ? "This drop has already been claimed."
                  : "This drop has expired."}
              </div>
            )}

            {/* Comments */}
            <DropComments dropId={String(drop.id)} />
          </div>
        )}
      </motion.div>
    </>
  );
}
