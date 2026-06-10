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
  parseDropHint,
} from "@/lib/utils";
import { DropComments } from "@/components/DropComments";
import { UserHandle } from "@/components/UserHandle";
import { DROP_STATUS, type Drop, type LatLng, type Campaign } from "@/types";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useGracePeriod, GRACE_CLAIM_LIMIT } from "@/hooks/useGracePeriod";

function useCampaign(campaignId: string | null) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [claims, setClaims]     = useState(0);
  useEffect(() => {
    if (!campaignId) { setCampaign(null); return; }
    fetch(`/api/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((d) => { if (d.campaign) { setCampaign(d.campaign); setClaims(d.claims ?? 0); } })
      .catch(() => {});
  }, [campaignId]);
  return { campaign, claims };
}

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
  const { inGrace, left, contractEnforces } = useGracePeriod();
  const { writeContractAsync } = useWriteContract();

  const verificationOk = isVerified || inGrace;
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState("");

  const parsed = drop ? parseDropHint(drop.hint) : null;
  const { campaign, claims } = useCampaign(parsed?.campaignId ?? null);

  const open = drop !== null;

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

  const isExpired  = drop ? drop.expiry < Math.floor(Date.now() / 1000) : false;
  const isActive   = drop ? drop.status === DROP_STATUS.Active && !isExpired : false;
  const isSelfDrop = drop ? address?.toLowerCase() === drop.dropper.toLowerCase() : false;
  const isClose    = distance !== null && distance <= CLAIM_RADIUS_M;

  const canClaim =
    isConnected && verificationOk && isActive && !isSelfDrop && isClose && status === "idle";

  const proximityPct =
    distance !== null ? Math.max(0, Math.min(100, (1 - distance / 500) * 100)) : 0;

  async function handleClaim() {
    if (!canClaim || !drop || !address) return;
    setStatus("claiming");
    setErrMsg("");
    try {
      const proofRes = await fetch("/api/claim-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropId:  drop.id.toString(),
          claimer: address,
          userLat: userLocation?.lat,
          userLng: userLocation?.lng,
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
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("done");
      if (address) {
        fetch("/api/engagement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        }).catch(() => {});
      }
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong — try again.");
      setStatus("error");
    }
  }

  function claimLabel() {
    if (status === "claiming") return "⏳ Claiming…";
    if (status === "error")    return "Try again";
    if (!isConnected)          return "Sign in to claim";
    if (!verificationOk)       return "🪪 Verification required";
    if (isSelfDrop)            return "Can't claim own drop";
    if (!userLocation)         return "Enable GPS to claim";
    if (!isClose)              return `${Math.round(distance ?? 0)}m away — get closer`;
    return `Claim ${formatG$(drop!.amount)} G$ →`;
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
          backgroundColor: "rgba(17,17,17,0.6)",
          backdropFilter: "blur(3px)",
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
          maxHeight: "88dvh",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {drop && (() => {
          const rarity  = getDropRarity(drop.amount);
          const r       = RARITY[rarity];
          const flash   = isFlashDrop(drop);
          const isChain = parsed?.chainNextId !== null || parsed?.isChainLast;

          // UBI prompt — verified only
          const ubiPrompt = isVerified ? (
            <button
              onClick={() => { onSuccess(); setTimeout(() => window.dispatchEvent(new CustomEvent("gd:openWallet")), 300); }}
              style={{
                width: "100%", padding: "13px 16px",
                background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)",
                borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 12, textAlign: "left",
              }}
            >
              <span style={{ fontSize: 22, flexShrink: 0 }}>💰</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#fff", lineHeight: 1.3 }}>
                  Claim your daily G$ UBI
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                  Tap to open wallet → claim GoodDollar UBI
                </p>
              </div>
              <span style={{ color: "#555", fontSize: 16 }}>→</span>
            </button>
          ) : null;

          return (
            <>
              {/* ── DARK HERO HEADER ─────────────────────────────────────────── */}
              <div style={{
                background: "#111",
                borderTop: `4px solid ${flash ? "#FF6400" : r.color}`,
                borderRadius: "24px 24px 0 0",
                padding: "14px 20px 24px",
                position: "relative",
              }}>
                {/* Drag handle */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
                </div>

                {/* Close */}
                <button
                  onClick={onClose}
                  style={{
                    position: "absolute", top: 14, right: 16,
                    width: 30, height: 30, borderRadius: "50%",
                    background: "rgba(255,255,255,0.07)", border: "none",
                    color: "#666", cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700,
                  }}
                >✕</button>

                {/* Badges */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                  <span style={{
                    background: flash ? "#FF6400" : r.color,
                    color: flash ? "#fff" : r.textColor,
                    fontSize: 9, fontWeight: 900,
                    padding: "3px 10px", borderRadius: 100,
                    letterSpacing: "0.12em", textTransform: "uppercase",
                    animation: flash ? "pin-flash 0.8s ease-in-out infinite" : "none",
                  }}>
                    {flash ? "⚡ Flash Drop" : r.label}
                  </span>
                  {isChain && (
                    <span style={{
                      background: "#BFFD00", color: "#111",
                      fontSize: 9, fontWeight: 900,
                      padding: "3px 10px", borderRadius: 100,
                      letterSpacing: "0.12em", textTransform: "uppercase",
                    }}>🔗 {parsed?.isChainLast ? "Final Stop" : "Chain Drop"}</span>
                  )}
                  {campaign && (
                    <span style={{
                      background: campaign.color, color: "#111",
                      fontSize: 9, fontWeight: 900,
                      padding: "3px 10px", borderRadius: 100,
                      letterSpacing: "0.12em", textTransform: "uppercase",
                    }}>⭐ {campaign.name}</span>
                  )}
                </div>

                {/* Amount — the star */}
                <div style={{ lineHeight: 1, marginBottom: 14 }}>
                  <span style={{
                    fontSize: 72, fontWeight: 900, color: "#fff",
                    letterSpacing: "-0.03em",
                  }}>
                    {formatG$(drop.amount)}
                  </span>
                  <span style={{
                    fontSize: 40, fontWeight: 900,
                    color: flash ? "#FF6400" : "#BFFD00",
                    marginLeft: 8,
                  }}>G$</span>
                </div>

                {/* Meta row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {isActive && (
                    <span style={{
                      background: flash ? "#FF640025" : "rgba(255,255,255,0.06)",
                      color: flash ? "#FF6400" : "#888",
                      fontSize: 11, fontWeight: 700,
                      padding: "3px 9px", borderRadius: 6,
                    }}>
                      ⏰ {timeLeft(drop.expiry)}
                    </span>
                  )}
                  {!isActive && (
                    <span style={{
                      background: drop.status === DROP_STATUS.Claimed ? "#BFFD0020" : "#FF3B3B20",
                      color: drop.status === DROP_STATUS.Claimed ? "#BFFD00" : "#FF3B3B",
                      fontSize: 11, fontWeight: 700,
                      padding: "3px 9px", borderRadius: 6,
                    }}>
                      {drop.status === DROP_STATUS.Claimed ? "✓ Claimed" : "Expired"}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "#555" }}>
                    by <UserHandle address={drop.dropper} />
                  </span>
                </div>
              </div>

              {/* ── BODY ──────────────────────────────────────────────────────── */}
              <div style={{ padding: "18px 18px 40px", display: "flex", flexDirection: "column", gap: 12 }}>

                {/* Campaign banner */}
                {campaign && (
                  <div style={{
                    background: `${campaign.color}12`,
                    border: `2px solid ${campaign.color}`,
                    borderRadius: 14, padding: "12px 14px",
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <div style={{
                      width: 38, height: 38, background: campaign.color,
                      borderRadius: 10, border: "2px solid rgba(0,0,0,0.12)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 16, fontWeight: 900, color: "#111", flexShrink: 0,
                      overflow: "hidden",
                    }}>
                      {campaign.logo
                        ? <img src={campaign.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        : campaign.name.charAt(0).toUpperCase()
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: "0 0 1px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>⭐ Sponsored Drop</p>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campaign.name}</p>
                      {campaign.description && (
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
                          {campaign.description}
                        </p>
                      )}
                      {campaign.goodcollectivePool && (
                        <a
                          href={`https://goodcollective.xyz/pool/${campaign.goodcollectivePool}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ textDecoration: "none", display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 800, background: "#111", color: "#BFFD00", padding: "2px 8px", borderRadius: 100 }}
                          onClick={(e) => e.stopPropagation()}
                        >🤝 GoodCollective Pool ↗</a>
                      )}
                    </div>
                    {claims > 0 && (
                      <div style={{ textAlign: "center", flexShrink: 0 }}>
                        <p style={{ margin: 0, fontWeight: 900, fontSize: 20, lineHeight: 1 }}>{claims}</p>
                        <p style={{ margin: 0, fontSize: 10, color: "#888" }}>claimed</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Hint card */}
                {parsed?.hint && (
                  <div style={{
                    background: "#fff", border: "2px dashed #111",
                    borderRadius: 14, padding: "14px 16px",
                  }}>
                    <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888" }}>🔍 Clue</p>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#111", lineHeight: 1.6 }}>{parsed.hint}</p>
                  </div>
                )}

                {/* ── SUCCESS ──────────────────────────────────────────────── */}
                {status === "done" && (() => {
                  // Chain middle
                  if (parsed?.chainNextId) return (
                    <div style={{
                      background: "#111", border: "2px solid #111",
                      borderRadius: 18, boxShadow: "4px 4px 0 #BFFD00",
                      padding: "28px 20px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 52, marginBottom: 12 }}>🔗</div>
                      <p style={{ margin: "0 0 6px", fontWeight: 900, fontSize: 22, color: "#BFFD00" }}>Next stop unlocked!</p>
                      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666" }}>
                        {formatG$(drop.amount)} G$ claimed. Keep going — the chain continues!
                      </p>
                      <a
                        href={`/drop/${parsed.chainNextId}`}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: "100%", padding: "15px",
                          background: "#BFFD00", color: "#111",
                          border: "2px solid #BFFD00", borderRadius: 14,
                          fontWeight: 900, fontSize: 16, textDecoration: "none",
                          boxShadow: "3px 3px 0 rgba(191,253,0,0.3)",
                        }}
                      >
                        Go to next stop →
                      </a>
                      <button onClick={onSuccess} style={{
                        marginTop: 12, width: "100%", padding: "10px",
                        background: "transparent", border: "none",
                        color: "#555", fontWeight: 700, fontSize: 13,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>
                        Back to map
                      </button>
                    </div>
                  );

                  // Chain last / regular success
                  const isChainWin = parsed?.isChainLast;
                  return (
                    <div style={{
                      background: "#111", border: "2px solid #111",
                      borderRadius: 18,
                      boxShadow: `4px 4px 0 ${isChainWin ? "#FFD700" : "#BFFD00"}`,
                      padding: "28px 20px 22px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 60, marginBottom: 8, lineHeight: 1 }}>
                        {isChainWin ? "🏆" : "🎯"}
                      </div>
                      <p style={{ margin: "0 0 4px", fontWeight: 900, fontSize: 24, color: "#BFFD00", letterSpacing: "-0.02em" }}>
                        {isChainWin ? "Hunt Complete!" : "You found it!"}
                      </p>
                      <div style={{ margin: "12px 0 20px" }}>
                        <span style={{ fontSize: 48, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em" }}>
                          {formatG$(drop.amount)}
                        </span>
                        <span style={{ fontSize: 28, fontWeight: 900, color: "#BFFD00", marginLeft: 6 }}>G$</span>
                      </div>
                      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666" }}>
                        {isChainWin ? "You conquered the entire chain!" : "Transferred to your wallet."}
                      </p>

                      {/* Share */}
                      <button
                        onClick={() => {
                          const text = isChainWin
                            ? `I just completed a GoodDrops Hunt Chain 🏆 and claimed ${formatG$(drop.amount)} G$!\n\nMulti-stop real-world treasure hunt on GoodDrops 💰\n\n#GoodDollar #GoodDrops`
                            : `I just found a hidden drop of ${formatG$(drop.amount)} G$ in the wild 🎯💰\n\nGoodDrops lets you hide and hunt real money IRL!\n\n#GoodDollar #GoodDrops #Web3`;
                          window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
                        }}
                        style={{
                          width: "100%", padding: "13px",
                          background: "transparent", color: "#fff",
                          border: "1.5px solid rgba(255,255,255,0.2)", borderRadius: 12,
                          fontWeight: 800, fontSize: 14,
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          marginBottom: 10,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
                      >
                        Post on 𝕏 ↗
                      </button>

                      {ubiPrompt}

                      <button onClick={onSuccess} style={{
                        marginTop: 10, width: "100%", padding: "10px",
                        background: "transparent", border: "none",
                        color: "#555", fontWeight: 700, fontSize: 13,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>
                        Done — back to map
                      </button>
                    </div>
                  );
                })()}

                {/* ── ACTIVE STATE ─────────────────────────────────────────── */}
                {status !== "done" && isActive && (
                  <>
                    {/* Proximity — hidden for own drops */}
                    {!isSelfDrop && isClose ? (
                      <div style={{
                        background: "#BFFD00", border: "2px solid #111",
                        borderRadius: 14, padding: "14px 16px",
                        display: "flex", alignItems: "center", gap: 12,
                        boxShadow: "2px 2px 0 #111",
                      }}>
                        <span style={{ fontSize: 28, flexShrink: 0 }}>📍</span>
                        <div>
                          <p style={{ margin: 0, fontWeight: 900, fontSize: 15, color: "#111" }}>You're in range!</p>
                          <p style={{ margin: 0, fontSize: 12, color: "#333" }}>
                            {Math.round(distance!)}m — close enough to claim
                          </p>
                        </div>
                      </div>
                    ) : !isSelfDrop ? (
                      <div style={{
                        background: "#fff", border: "2px solid #111",
                        borderRadius: 14, padding: "14px 16px",
                        boxShadow: "2px 2px 0 #111",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            Distance
                          </span>
                          <span style={{ fontSize: 28, fontWeight: 900, color: "#111", letterSpacing: "-0.02em" }}>
                            {distance !== null ? `${Math.round(distance)}m` : "—"}
                          </span>
                        </div>
                        <div style={{ height: 10, background: "#eee", borderRadius: 100, overflow: "hidden", border: "1.5px solid #ddd" }}>
                          <motion.div
                            animate={{ width: `${proximityPct}%` }}
                            transition={{ duration: 0.5 }}
                            style={{
                              height: "100%", borderRadius: 100,
                              background: proximityPct > 65 ? "#FF6400" : "#ccc",
                              transition: "background 0.5s",
                            }}
                          />
                        </div>
                        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#aaa", textAlign: "center" }}>
                          Must be within {CLAIM_RADIUS_M}m to claim
                        </p>
                      </div>
                    ) : null}

                    {/* Walk there */}
                    {!isSelfDrop && !isClose && (
                      <button
                        onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
                        style={{
                          width: "100%", padding: "12px",
                          background: "#fff", border: "2px solid #111",
                          borderRadius: 12, fontWeight: 700, fontSize: 13,
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          boxShadow: "2px 2px 0 #111",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f4f0"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                      >
                        🧭 Walk there
                      </button>
                    )}

                    {/* Hunt mode */}
                    {onHunt && !isSelfDrop && !isClose && (
                      <button
                        onClick={() => { onClose(); onHunt(drop); }}
                        style={{
                          width: "100%", padding: "12px",
                          background: "#111", color: "#BFFD00",
                          border: "2px solid #111", borderRadius: 12,
                          fontWeight: 800, fontSize: 13,
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          boxShadow: "2px 2px 0 #BFFD00",
                        }}
                      >
                        🎯 Hunt this drop
                      </button>
                    )}


                    {/* Error */}
                    {status === "error" && errMsg && (
                      <div style={{
                        background: "#FFE5E5", border: "2px solid #FF3B3B",
                        borderRadius: 12, padding: "12px 14px",
                        fontSize: 13, color: "#FF3B3B", fontWeight: 600,
                      }}>
                        {errMsg}
                      </div>
                    )}

                    {/* ── CLAIM BUTTON ── */}
                    <button
                      onClick={status === "error" ? () => setStatus("idle") : handleClaim}
                      disabled={status === "claiming" || (status !== "error" && !canClaim)}
                      style={{
                        width: "100%", padding: "20px",
                        background: (canClaim || status === "error") ? "#BFFD00" : "#eee",
                        color: (canClaim || status === "error") ? "#111" : "#aaa",
                        border: "2.5px solid",
                        borderColor: (canClaim || status === "error") ? "#111" : "#ddd",
                        borderRadius: 16,
                        boxShadow: (canClaim || status === "error") ? "4px 4px 0 #111" : "none",
                        fontWeight: 900, fontSize: 18,
                        cursor: (canClaim || status === "error") ? "pointer" : "not-allowed",
                        fontFamily: "inherit",
                        letterSpacing: "-0.01em",
                        animation: canClaim ? "pulse 2s ease-in-out infinite" : "none",
                        transition: "background 0.15s, box-shadow 0.15s, transform 0.1s",
                      }}
                      onMouseEnter={(e) => { if (canClaim) { e.currentTarget.style.boxShadow = "2px 2px 0 #111"; e.currentTarget.style.transform = "translate(2px,2px)"; } }}
                      onMouseLeave={(e) => { if (canClaim) { e.currentTarget.style.boxShadow = "4px 4px 0 #111"; e.currentTarget.style.transform = "translate(0,0)"; } }}
                    >
                      {claimLabel()}
                    </button>

                    {/* Grace period counter */}
                    {isConnected && !isVerified && inGrace && (
                      <div style={{
                        background: "#f0fff4", border: "2px solid #111",
                        borderRadius: 12, padding: "12px 14px",
                        display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <span style={{ fontSize: 20, flexShrink: 0 }}>🎯</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                            {left} free claim{left !== 1 ? "s" : ""} remaining
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                            Verify anytime to unlock unlimited hunting
                          </p>
                        </div>
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent("gd:openVerify"))}
                          style={{
                            background: "transparent", color: "#111",
                            border: "2px solid #111", borderRadius: 8,
                            padding: "5px 12px", fontWeight: 800, fontSize: 11,
                            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                          }}
                        >
                          Verify
                        </button>
                      </div>
                    )}

                    {/* Grace exhausted */}
                    {isConnected && !isVerified && !inGrace && (
                      <div style={{
                        background: "#fff8e6", border: "2px solid #111",
                        borderRadius: 12, padding: "12px 14px",
                        display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <span style={{ fontSize: 22, flexShrink: 0 }}>🪪</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>Verification required</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                            You've used all {GRACE_CLAIM_LIMIT} free claims — verify to keep hunting
                          </p>
                        </div>
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent("gd:openVerify"))}
                          style={{
                            background: "#111", color: "#BFFD00",
                            border: "none", borderRadius: 8,
                            padding: "8px 12px", fontWeight: 900, fontSize: 11,
                            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                          }}
                        >
                          Verify →
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Flash urgency notice */}
                {isActive && flash && status !== "done" && (
                  <div style={{
                    background: "#FF640010", border: "1.5px solid #FF640050",
                    borderRadius: 10, padding: "10px 14px",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>⚡</span>
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "#FF6400" }}>
                        Flash Drop — {timeLeft(drop.expiry)} left!
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>
                        Expires very soon — hurry!
                      </p>
                    </div>
                  </div>
                )}

                {/* Inactive state */}
                {!isActive && status !== "done" && (
                  <div style={{
                    background: "#fff", border: "2px solid #ddd",
                    borderRadius: 14, padding: "24px 20px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>
                      {drop.status === DROP_STATUS.Claimed ? "🎯" : "⌛"}
                    </div>
                    <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 16, color: "#111" }}>
                      {drop.status === DROP_STATUS.Claimed ? "Already claimed" : "Drop has expired"}
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: "#888" }}>
                      {drop.status === DROP_STATUS.Claimed ? "Someone beat you to it!" : "This drop is no longer active."}
                    </p>
                  </div>
                )}

                {/* Comments */}
                <DropComments dropId={String(drop.id)} dropper={drop.dropper} />
              </div>
            </>
          );
        })()}
      </motion.div>
    </>
  );
}
