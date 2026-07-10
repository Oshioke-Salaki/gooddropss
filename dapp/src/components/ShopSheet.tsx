"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWriteContract } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { parseUnits } from "viem";
import { Store, Check } from "lucide-react";
import { publicClient } from "@/lib/publicClient";
import { G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { haversineDistance, formatG$, formatUsdApprox } from "@/lib/utils";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { Celebration } from "@/components/Celebration";
import type { Spot, LatLng } from "@/types";

// How close a customer must be to pay — generous enough for GPS drift indoors,
// tight enough that payment still guarantees the merchant real foot traffic.
const PAY_RADIUS_M = 150;

const CATEGORY_EMOJI: Record<string, string> = {
  food: "🍲", retail: "🛍️", services: "🔧", transport: "🛺", other: "🏪",
};

type PayStatus = "idle" | "paying" | "done" | "error";

interface Props {
  spot: Spot | null;
  userLocation: LatLng | null;
  onClose: () => void;
}

export function ShopSheet({ spot, userLocation, onClose }: Props) {
  const { address, isConnected } = useSignedInAccount();
  const { login } = useAuth();
  const { balance } = useGoodDollarProfile();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount]   = useState("");
  const [status, setStatus]   = useState<PayStatus>("idle");
  const [errMsg, setErrMsg]   = useState("");
  const [paidTx, setPaidTx]   = useState("");

  const open = spot !== null;

  const distance = spot && userLocation
    ? Math.round(haversineDistance(userLocation.lat, userLocation.lng, spot.lat, spot.lng))
    : null;
  const inRange = distance !== null && distance <= PAY_RADIUS_M;

  let amountWei = 0n;
  try { amountWei = amount ? parseUnits(amount, 18) : 0n; } catch { /* partial input */ }
  const insufficient = amountWei > 0n && amountWei > balance;

  const canPay =
    isConnected && inRange && amountWei > 0n && !insufficient && status === "idle";

  async function handlePay() {
    if (!spot || !address || !canPay) return;
    setStatus("paying");
    setErrMsg("");
    try {
      const tx = await writeContractAsync({
        address: G_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [spot.wallet as `0x${string}`, amountWei],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setPaidTx(tx);
      setStatus("done");
      // Record for merchant analytics (fire-and-forget)
      fetch(`/api/spots/${spot.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payer: address, amount: amountWei.toString(), tx }),
      }).catch(() => {});
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Payment failed — try again.");
      setStatus("error");
    }
  }

  function close() {
    setAmount("");
    setStatus("idle");
    setErrMsg("");
    setPaidTx("");
    onClose();
  }

  return (
    <AnimatePresence>
      {open && spot && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            style={{
              position: "fixed", inset: 0, zIndex: 1100,
              background: "rgba(17,17,17,0.5)", backdropFilter: "blur(3px)",
            }}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 350 }}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1101,
              maxWidth: 520, margin: "0 auto",
              maxHeight: "88dvh", overflowY: "auto",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {/* ── Dark hero header ─────────────────────────────────────────── */}
            <div style={{
              background: "#111",
              borderTop: "4px solid #BFFD00",
              borderRadius: "24px 24px 0 0",
              padding: "14px 20px 22px",
              position: "relative",
            }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
              </div>
              <button
                onClick={close}
                style={{
                  position: "absolute", top: 14, right: 16,
                  width: 30, height: 30, borderRadius: "50%",
                  background: "rgba(255,255,255,0.07)", border: "none",
                  color: "#666", cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700,
                }}
              >✕</button>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{
                  background: "#BFFD00", color: "#111",
                  fontSize: 9, fontWeight: 900,
                  padding: "3px 10px", borderRadius: 100,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                }}>
                  🏪 Accepts G$
                </span>
                {spot.discount && (
                  <span style={{
                    background: "#FF6400", color: "#fff",
                    fontSize: 9, fontWeight: 900,
                    padding: "3px 10px", borderRadius: 100,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>
                    🎁 {spot.discount}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 52, height: 52, flexShrink: 0,
                  background: "#BFFD00", borderRadius: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26,
                }}>
                  {CATEGORY_EMOJI[spot.category] ?? "🏪"}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, color: "#fff", fontWeight: 900, fontSize: 22, lineHeight: 1.15 }}>
                    {spot.name}
                  </p>
                  {spot.description && (
                    <p style={{ margin: "3px 0 0", color: "#888", fontSize: 12, lineHeight: 1.4 }}>
                      {spot.description}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Body ─────────────────────────────────────────────────────── */}
            <div style={{ background: "#f5f4f0", padding: "18px 18px 40px", display: "flex", flexDirection: "column", gap: 12 }}>

              {status === "done" ? (
                <>
                  <Celebration active count={30} />
                  <div style={{
                    background: "#111", border: "2px solid #111",
                    borderRadius: 18, boxShadow: "4px 4px 0 #BFFD00",
                    padding: "28px 20px", textAlign: "center",
                  }}>
                    <div className="success-pop" style={{
                      width: 74, height: 74, margin: "0 auto 14px",
                      background: "#BFFD00", borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Check size={38} color="#111" strokeWidth={3} />
                    </div>
                    <p style={{ margin: "0 0 4px", fontWeight: 900, fontSize: 22, color: "#BFFD00" }}>
                      Paid with G$!
                    </p>
                    <p style={{ margin: "0 0 4px", fontSize: 15, color: "#fff", fontWeight: 700 }}>
                      {amount} G$ → {spot.name}
                    </p>
                    <a
                      href={`https://celoscan.io/tx/${paidTx}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "#666", textDecoration: "underline" }}
                    >
                      View transaction ↗
                    </a>
                    <button
                      onClick={close}
                      style={{
                        marginTop: 18, width: "100%", padding: "14px",
                        background: "#BFFD00", color: "#111",
                        border: "none", borderRadius: 14,
                        fontWeight: 900, fontSize: 15,
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Proximity gate */}
                  <div style={{
                    background: inRange ? "#BFFD00" : "#fff",
                    border: "2px solid #111", borderRadius: 14,
                    boxShadow: "2px 2px 0 #111",
                    padding: "13px 16px",
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <span style={{ fontSize: 24, flexShrink: 0 }}>📍</span>
                    <div>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 14, color: "#111" }}>
                        {!userLocation ? "Enable GPS to pay here"
                          : inRange ? "You're at the shop!"
                          : `${distance}m away`}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: inRange ? "#333" : "#888" }}>
                        {inRange
                          ? "Payment unlocked — pay in person with G$"
                          : `Get within ${PAY_RADIUS_M}m to unlock payment`}
                      </p>
                    </div>
                  </div>

                  {/* Amount input */}
                  <div style={{
                    background: "#fff", border: "2px solid #111",
                    borderRadius: 14, boxShadow: "2px 2px 0 #111",
                    padding: "14px 16px",
                  }}>
                    <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888" }}>
                      Amount to pay
                    </p>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        style={{
                          flex: 1, minWidth: 0,
                          background: "transparent", border: "none", outline: "none",
                          fontSize: 38, fontWeight: 900, color: "#111",
                          fontFamily: "inherit",
                        }}
                      />
                      <span style={{ fontSize: 22, fontWeight: 900, color: "#BFFD00", WebkitTextStroke: "1px #111" }}>G$</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: insufficient ? "#FF3B3B" : "#888", fontWeight: 600 }}>
                        {insufficient ? "Not enough G$" : `Balance: ${formatG$(balance)} G$`}
                      </span>
                      {amountWei > 0n && formatUsdApprox(amountWei) && (
                        <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>
                          {formatUsdApprox(amountWei)}
                        </span>
                      )}
                    </div>
                  </div>

                  {status === "error" && errMsg && (
                    <div style={{
                      background: "#FFE5E5", border: "2px solid #FF3B3B",
                      borderRadius: 12, padding: "12px 14px",
                      fontSize: 13, color: "#FF3B3B", fontWeight: 600,
                    }}>
                      {errMsg}
                    </div>
                  )}

                  {/* Pay CTA */}
                  {!isConnected ? (
                    <button
                      onClick={login}
                      style={{
                        width: "100%", padding: "18px",
                        background: "#111", color: "#BFFD00",
                        border: "2.5px solid #111", borderRadius: 16,
                        boxShadow: "4px 4px 0 #BFFD00",
                        fontWeight: 900, fontSize: 17,
                        cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                      }}
                    >
                      <Store size={18} /> Sign in to pay
                    </button>
                  ) : (
                    <button
                      onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handlePay}
                      disabled={status === "paying" || (status !== "error" && !canPay)}
                      style={{
                        width: "100%", padding: "18px",
                        background: (canPay || status === "error") ? "#BFFD00" : "#eee",
                        color: (canPay || status === "error") ? "#111" : "#aaa",
                        border: "2.5px solid",
                        borderColor: (canPay || status === "error") ? "#111" : "#ddd",
                        borderRadius: 16,
                        boxShadow: (canPay || status === "error") ? "4px 4px 0 #111" : "none",
                        fontWeight: 900, fontSize: 17,
                        cursor: (canPay || status === "error") ? "pointer" : "not-allowed",
                        fontFamily: "inherit",
                      }}
                    >
                      {status === "paying" ? "Paying…"
                        : status === "error" ? "Try again"
                        : !inRange ? "Get closer to pay"
                        : amountWei === 0n ? "Enter an amount"
                        : insufficient ? "Not enough G$"
                        : `Pay ${amount} G$`}
                    </button>
                  )}

                  <p style={{ margin: 0, fontSize: 11, color: "#888", textAlign: "center", lineHeight: 1.5 }}>
                    G$ goes directly to the merchant&apos;s wallet — no middleman, near-zero fees.
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
