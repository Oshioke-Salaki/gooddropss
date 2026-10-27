"use client";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { ArrowLeft, Check, Loader2, Lock, Navigation } from "lucide-react";
import { publicClient } from "@/lib/publicClient";
import { friendlyClaimError } from "@/lib/claimErrors";
import { ensureGasForClaim } from "@/lib/ensureGas";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import {
  haversineDistance,
  calculateBearing,
  formatG$,
  gpsToDeg,
  getDropRarity,
  RARITY,
  openGoogleMapsWalking,
} from "@/lib/utils";
import { fireChestReward } from "@/components/ChestReward";
import type { Drop, LatLng } from "@/types";
import { track, claimFailReason } from "@/lib/analytics";

interface Props {
  drop: Drop;
  userLocation: LatLng | null;
  onClose: () => void;
  onSuccess: () => void;
  privateToken?: string;
  dropCoords?: { lat: number; lng: number };
}

type ClaimStatus = "idle" | "gassing" | "claiming" | "done" | "error";

const MAX_RANGE = 800;
const BRAND = "#2727E2";

export function HuntingMode({ drop, userLocation, onClose, onSuccess, privateToken, dropCoords }: Props) {
  const { address } = useAccount();
  const { writeContractAsync, sponsored } = useSponsoredWrite();

  const [claimStatus, setClaimStatus] = useState<ClaimStatus>("idle");
  const [errMsg, setErrMsg]           = useState("");
  const [liveLocation, setLiveLocation] = useState<LatLng | null>(userLocation);
  const watchRef = useRef<number | null>(null);

  // High-accuracy GPS watch while in hunting mode
  useEffect(() => {
    if (!navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => setLiveLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 1_500, timeout: 10_000 }
    );
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const dropLat = dropCoords?.lat ?? gpsToDeg(drop.lat);
  const dropLng = dropCoords?.lng ?? gpsToDeg(drop.lng);

  const distance = liveLocation
    ? Math.round(haversineDistance(liveLocation.lat, liveLocation.lng, dropLat, dropLng))
    : null;

  const bearing = liveLocation
    ? calculateBearing(liveLocation.lat, liveLocation.lng, dropLat, dropLng)
    : 0;

  const isClose       = distance !== null && distance <= CLAIM_RADIUS_M;
  const proximityPct  = distance !== null
    ? Math.max(0, Math.min(100, (1 - distance / MAX_RANGE) * 100))
    : 0;

  const rarity     = getDropRarity(drop.amount);
  useEffect(() => { track("hunt_started"); }, []);
  const rarityInfo = RARITY[rarity];

  const R   = 90;
  const circumference = 2 * Math.PI * R;
  const strokeDash    = (proximityPct / 100) * circumference;

  function statusText() {
    if (distance === null) return "Acquiring GPS…";
    if (distance <= 15)    return "Right on it. Claim now";
    if (distance <= CLAIM_RADIUS_M) return "You're here. Claim it";
    if (distance <= 200)   return "Almost there";
    if (distance <= 400)   return "Getting warmer";
    return "Head towards the arrow";
  }

  async function handleClaim() {
    if (!address || !isClose || claimStatus !== "idle") return;
    track("claim_started", { surface: "hunt" });
    setClaimStatus("claiming");
    try {
      // Guarantee gas before the claim so a low wallet never dead-ends mid-tx.
      // Sponsored Magic wallets need no CELO, so skip the faucet for them.
      if (!(await sponsored())) await ensureGasForClaim(address as `0x${string}`, () => setClaimStatus("gassing"));
      setClaimStatus("claiming");

      const proofRes = await fetch("/api/claim-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropId:  drop.id.toString(),
          claimer: address,
          userLat: liveLocation?.lat,
          userLng: liveLocation?.lng,
          ...(privateToken ? { privateToken } : {}),
        }),
      });

      if (!proofRes.ok) {
        const body = await proofRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not verify location — try again.");
      }

      const { deadline, sig } = await proofRes.json();
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "claimWithProof",
        args: [drop.id, BigInt(deadline), sig as `0x${string}`],
      }, { onToppingUp: () => setClaimStatus("gassing") });

      await publicClient.waitForTransactionReceipt({ hash: tx });
      setClaimStatus("done");
      track("claim_succeeded", { rarity, surface: "hunt" });
      fireChestReward(formatG$(drop.amount), rarity);
    } catch (e: unknown) {
      track("claim_failed", { reason: claimFailReason(e), surface: "hunt" });
      const fe = friendlyClaimError(e);
      if (fe.kind === "rejected") { setClaimStatus("idle"); setErrMsg(""); return; }
      setErrMsg(fe.message);
      setClaimStatus("error");
    }
  }

  const busy = claimStatus === "claiming" || claimStatus === "gassing";
  const claimable = isClose || claimStatus === "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: "spring", damping: 28, stiffness: 380 }}
      role="dialog"
      aria-modal="true"
      aria-label="Hunting mode"
      className="fixed inset-0 z-[1500] bg-surface font-sans flex flex-col overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 lg:px-15 pb-4 bg-white border-b border-line"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 16px)" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to map"
          className="w-10 h-10 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center
            cursor-pointer motion-safe:transition-colors hover:bg-nav-controls"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.75} />
        </button>

        <div className="flex-1 min-w-0 flex flex-col gap-y-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center gap-1.5 shrink-0 rounded-full bg-surface px-2.5 py-1.5 text-xs/none text-heading">
              <span className="w-2 h-2 rounded-full" style={{ background: rarityInfo.color }} aria-hidden />
              {rarityInfo.label}
            </span>
            <span className="text-xl/none text-heading truncate">{formatG$(drop.amount)} G$</span>
          </div>
          {drop.hint && (
            <p className="text-sm/none text-nav-muted truncate">&ldquo;{drop.hint}&rdquo;</p>
          )}
        </div>
      </div>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      {claimStatus === "done" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 14, stiffness: 300 }}
            className="w-24 h-24 rounded-full bg-brand-soft text-brand flex items-center justify-center"
          >
            <Check className="w-12 h-12" strokeWidth={2.5} />
          </motion.div>
          <div className="flex flex-col gap-y-3">
            <p className="text-[32px]/none text-heading">You got it</p>
            <p className="text-base/[140%] text-nav-muted">{formatG$(drop.amount)} G$ is in your wallet.</p>
          </div>
          <button
            type="button"
            onClick={onSuccess}
            className="h-14 px-10 rounded-full bg-brand text-white text-base/none cursor-pointer
              motion-safe:transition-colors hover:bg-brand/90"
          >
            Back to map
          </button>
        </div>
      ) : (
        <div
          className="flex-1 flex flex-col items-center justify-between gap-6 px-6 pt-7 w-full max-w-[440px] mx-auto"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 24px)" }}
        >
          {/* Ring + status read as one unit; the actions sit at the thumb end. */}
          <div className="flex flex-col items-center gap-6 my-auto">
          {/* Proximity ring */}
          <div className="relative">
            <svg width={240} height={240} viewBox="0 0 240 240" className="overflow-visible">
              {/* Outer tick marks */}
              {Array.from({ length: 36 }, (_, i) => {
                const a  = ((i * 10) - 90) * Math.PI / 180;
                const r1 = i % 9 === 0 ? 108 : i % 3 === 0 ? 112 : 115;
                return (
                  <line key={i}
                    x1={120 + r1 * Math.cos(a)} y1={120 + r1 * Math.sin(a)}
                    x2={120 + 120 * Math.cos(a)} y2={120 + 120 * Math.sin(a)}
                    stroke={i % 9 === 0 ? "#D0D0D0" : "#E4E4E4"}
                    strokeWidth={i % 9 === 0 ? 1.5 : 0.8}
                  />
                );
              })}

              {/* Track circle */}
              <circle cx={120} cy={120} r={R} fill="none" stroke="#ECECEC" strokeWidth={16} />

              {/* Ambient glow when in range */}
              {isClose && (
                <circle cx={120} cy={120} r={R} fill="none"
                  stroke={BRAND} strokeWidth={16} opacity={0.18}
                  className="hunt-ring-pulse"
                  style={{ filter: "blur(6px)" }}
                />
              )}

              {/* Progress arc. A round cap on a zero-length dash still paints a
                  dot, so the cap only comes in once there is an arc to cap. */}
              <circle
                cx={120} cy={120} r={R}
                fill="none"
                stroke={BRAND}
                strokeOpacity={isClose ? 1 : 0.35}
                strokeWidth={16}
                strokeLinecap={proximityPct > 2 ? "round" : "butt"}
                strokeDasharray={`${strokeDash} ${circumference}`}
                transform="rotate(-90 120 120)"
                style={{
                  transition: "stroke-dasharray 0.7s ease, stroke-opacity 0.5s ease",
                  filter: isClose ? "drop-shadow(0 0 8px rgba(39,39,226,0.45))" : "none",
                }}
              />

              {/* Bearing arrow (points toward drop) */}
              {liveLocation && distance !== null && distance > CLAIM_RADIUS_M && (
                <g transform={`translate(120,120) rotate(${bearing})`}>
                  <path d="M0,-66 L-7,-46 L0,-54 L7,-46 Z" fill={BRAND} />
                </g>
              )}

              {/* Center: distance */}
              {distance !== null ? (
                <>
                  <text x={120} y={110} textAnchor="middle"
                    fill="#121607" fontSize={isClose ? 46 : 42}
                    style={{ fontFamily: "var(--font-anta), 'Anta', sans-serif" }}>
                    {distance < 1000 ? distance : `${(distance / 1000).toFixed(1)}k`}
                  </text>
                  <text x={120} y={134} textAnchor="middle" fill="#6B6E63" fontSize={13}
                    style={{ fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif" }}>
                    {distance < 1000 ? "metres away" : "km away"}
                  </text>
                </>
              ) : (
                <text x={120} y={124} textAnchor="middle" fill="#6B6E63" fontSize={13}
                  style={{ fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif" }}>
                  Locating…
                </text>
              )}
            </svg>
          </div>

          {/* Status text */}
          <motion.p
            key={statusText()}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
            aria-live="polite"
            className={`text-base/none text-center motion-safe:transition-colors ${isClose ? "text-brand" : "text-nav-muted"}`}
          >
            {statusText()}
          </motion.p>
          </div>

          {/* Directions */}
          <button
            type="button"
            onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
            className="h-11 px-5 rounded-full border border-line bg-white text-sm/none text-heading
              flex items-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface"
          >
            <Navigation className="w-4 h-4" strokeWidth={2} />
            Open in Google Maps
          </button>

          {/* Claim */}
          <div className="w-full">
            <p role="alert" className="h-4 mb-3 px-5 text-sm/none text-danger text-center truncate">
              {claimStatus === "error" ? errMsg : ""}
            </p>
            <button
              type="button"
              onClick={claimStatus === "error"
                ? () => { setClaimStatus("idle"); setErrMsg(""); }
                : handleClaim}
              disabled={busy || !claimable}
              className="w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2
                cursor-pointer motion-safe:transition-colors hover:bg-brand/90
                disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
              style={isClose && !busy ? { boxShadow: "0 8px 24px rgba(39,39,226,0.3)" } : undefined}
            >
              {claimStatus === "gassing"  ? <><Loader2 className="w-5 h-5 animate-spin" /> Topping up gas…</> :
               claimStatus === "claiming" ? <><Loader2 className="w-5 h-5 animate-spin" /> Claiming…</> :
               claimStatus === "error"    ? "Try again" :
               isClose ? `Claim ${formatG$(drop.amount)} G$` :
               <><Lock className="w-[18px] h-[18px]" strokeWidth={2} /> Get closer to unlock</>}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
