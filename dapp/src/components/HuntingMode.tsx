"use client";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useAccount, useWriteContract } from "wagmi";
import { ArrowLeft, Lock, CheckCircle, Navigation } from "lucide-react";
import { publicClient } from "@/lib/publicClient";
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
import type { Drop, LatLng } from "@/types";

interface Props {
  drop: Drop;
  userLocation: LatLng | null;
  onClose: () => void;
  onSuccess: () => void;
}

type ClaimStatus = "idle" | "claiming" | "done" | "error";

const MAX_RANGE = 800;

export function HuntingMode({ drop, userLocation, onClose, onSuccess }: Props) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

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

  const dropLat = gpsToDeg(drop.lat);
  const dropLng = gpsToDeg(drop.lng);

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
  const rarityInfo = RARITY[rarity];

  const R   = 90;
  const circumference = 2 * Math.PI * R;
  const strokeDash    = (proximityPct / 100) * circumference;

  function statusText() {
    if (distance === null) return "Acquiring GPS…";
    if (distance <= 15)    return "Right on it! Claim now!";
    if (distance <= CLAIM_RADIUS_M) return "You're here — claim it!";
    if (distance <= 200)   return "Almost there…";
    if (distance <= 400)   return "Getting warmer…";
    return "Head towards the arrow";
  }

  async function handleClaim() {
    if (!address || !isClose || claimStatus !== "idle") return;
    setClaimStatus("claiming");
    try {
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "claim",
        args: [drop.id],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setClaimStatus("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong — try again.");
      setClaimStatus("error");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: "spring", damping: 28, stiffness: 380 }}
      style={{
        position: "fixed", inset: 0, zIndex: 1500,
        background: "#08090f",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "env(safe-area-inset-top, 16px) 20px 14px",
        paddingTop: "max(env(safe-area-inset-top, 0px), 16px)",
        display: "flex", alignItems: "center", gap: 12,
        borderBottom: "1px solid #1e1e2e",
        flexShrink: 0,
        background: "#0a0b12",
      }}>
        <button
          onClick={onClose}
          style={{
            background: "#1a1a2e", border: "1px solid #333",
            borderRadius: 10, width: 38, height: 38,
            cursor: "pointer", color: "#888",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ArrowLeft size={18} />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              background: rarityInfo.color, color: rarityInfo.textColor,
              fontSize: 10, fontWeight: 900, padding: "2px 8px",
              borderRadius: 100, letterSpacing: "0.08em",
              textTransform: "uppercase", flexShrink: 0,
            }}>
              {rarityInfo.label}
            </span>
            <span style={{ color: "#fff", fontWeight: 900, fontSize: 20 }}>
              {formatG$(drop.amount)} G$
            </span>
          </div>
          {drop.hint && (
            <p style={{ margin: "3px 0 0", color: "#444", fontSize: 12, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              "{drop.hint}"
            </p>
          )}
        </div>
      </div>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      {claimStatus === "done" ? (
        // Success state
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 24, padding: "40px 24px",
        }}>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 14, stiffness: 300 }}
            style={{
              width: 100, height: 100, borderRadius: "50%",
              background: rarityInfo.color,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 60px ${rarityInfo.color}60`,
            }}
          >
            <CheckCircle size={52} color={rarityInfo.textColor} strokeWidth={2.5} />
          </motion.div>
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#fff", fontSize: 28, fontWeight: 900, margin: 0 }}>You got it!</p>
            <p style={{ color: "#555", fontSize: 15, margin: "8px 0 0" }}>
              {formatG$(drop.amount)} G$ is yours!
            </p>
          </div>
          <button
            onClick={onSuccess}
            style={{
              padding: "15px 40px",
              background: rarityInfo.color, color: rarityInfo.textColor,
              border: "none", borderRadius: 16,
              fontWeight: 900, fontSize: 16,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Back to map
          </button>
        </div>
      ) : (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "space-between",
          padding: "28px 24px max(env(safe-area-inset-bottom, 0px), 24px)",
        }}>
          {/* Proximity ring */}
          <div style={{ position: "relative" }}>
            <svg width={240} height={240} viewBox="0 0 240 240" style={{ overflow: "visible" }}>
              {/* Outer tick marks */}
              {Array.from({ length: 36 }, (_, i) => {
                const a  = ((i * 10) - 90) * Math.PI / 180;
                const r1 = i % 9 === 0 ? 108 : i % 3 === 0 ? 112 : 115;
                return (
                  <line key={i}
                    x1={120 + r1 * Math.cos(a)} y1={120 + r1 * Math.sin(a)}
                    x2={120 + 120 * Math.cos(a)} y2={120 + 120 * Math.sin(a)}
                    stroke={i % 9 === 0 ? "#2a2a3e" : "#181828"}
                    strokeWidth={i % 9 === 0 ? 1.5 : 0.8}
                  />
                );
              })}

              {/* Track circle */}
              <circle cx={120} cy={120} r={R} fill="none" stroke="#151520" strokeWidth={16} />

              {/* Ambient glow when in range */}
              {isClose && (
                <circle cx={120} cy={120} r={R} fill="none"
                  stroke={rarityInfo.color} strokeWidth={16} opacity={0.12}
                  className="hunt-ring-pulse"
                  style={{ filter: `blur(6px)` }}
                />
              )}

              {/* Progress arc */}
              <circle
                cx={120} cy={120} r={R}
                fill="none"
                stroke={isClose ? rarityInfo.color : "#BFFD0033"}
                strokeWidth={16}
                strokeLinecap="round"
                strokeDasharray={`${strokeDash} ${circumference}`}
                transform="rotate(-90 120 120)"
                style={{
                  transition: "stroke-dasharray 0.7s ease, stroke 0.5s ease",
                  filter: isClose ? `drop-shadow(0 0 8px ${rarityInfo.color})` : "none",
                }}
              />

              {/* Bearing arrow (points toward drop) */}
              {liveLocation && distance !== null && distance > CLAIM_RADIUS_M && (
                <g transform={`translate(120,120) rotate(${bearing})`}>
                  <path
                    d="M0,-66 L-7,-46 L0,-54 L7,-46 Z"
                    fill={rarityInfo.color}
                    opacity={0.9}
                    style={{ filter: `drop-shadow(0 0 4px ${rarityInfo.color})` }}
                  />
                </g>
              )}

              {/* Center: distance */}
              {distance !== null ? (
                <>
                  <text x={120} y={107} textAnchor="middle"
                    fill="white" fontSize={isClose ? 46 : 42} fontWeight={900}
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {distance < 1000 ? distance : `${(distance / 1000).toFixed(1)}k`}
                  </text>
                  <text x={120} y={130} textAnchor="middle" fill="#333" fontSize={13}
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {distance < 1000 ? "metres away" : "km away"}
                  </text>
                </>
              ) : (
                <text x={120} y={124} textAnchor="middle" fill="#333" fontSize={13}
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
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
            style={{
              color: isClose ? rarityInfo.color : "#555",
              fontSize: 15, fontWeight: 700, margin: 0,
              textAlign: "center",
              transition: "color 0.5s",
            }}
          >
            {statusText()}
          </motion.p>

          {/* Directions button */}
          <button
            onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              color: "#555",
              fontSize: 13,
              fontWeight: 600,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "6px 0",
              width: "100%",
            }}
          >
            <Navigation size={13} />
            Open in Google Maps
          </button>

          {/* Claim button */}
          <div style={{ width: "100%" }}>
            {claimStatus === "error" && errMsg && (
              <div style={{
                background: "rgba(255,59,59,0.1)", border: "1px solid #ff3b3b44",
                borderRadius: 10, padding: "10px 14px", marginBottom: 12,
                color: "#ff3b3b", fontSize: 13, fontWeight: 600,
              }}>
                {errMsg}
              </div>
            )}
            <button
              onClick={claimStatus === "error"
                ? () => { setClaimStatus("idle"); setErrMsg(""); }
                : handleClaim}
              disabled={claimStatus === "claiming" || (!isClose && claimStatus !== "error")}
              style={{
                width: "100%", padding: "17px",
                background: isClose || claimStatus === "error" ? rarityInfo.color : "#111",
                color: isClose || claimStatus === "error" ? rarityInfo.textColor : "#333",
                border: `1.5px solid ${isClose || claimStatus === "error" ? rarityInfo.color : "#1e1e2e"}`,
                borderRadius: 16,
                fontWeight: 900, fontSize: 17,
                cursor: isClose || claimStatus === "error" ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                transition: "all 0.35s ease",
                boxShadow: isClose ? `0 0 24px ${rarityInfo.color}50` : "none",
              }}
            >
              {claimStatus === "claiming" ? "Claiming…" :
               claimStatus === "error"    ? "Try again" :
               isClose ? `Claim ${formatG$(drop.amount)} G$` :
               <><Lock size={16} /> Get closer to unlock</>}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
