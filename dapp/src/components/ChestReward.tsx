"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Reward { amount: string; rarity: "common" | "uncommon" | "rare" | "legendary" }

// Fire the chest-open celebration after a successful claim.
export function fireChestReward(amount: string, rarity: Reward["rarity"]) {
  window.dispatchEvent(new CustomEvent("gd:claim-success", { detail: { amount, rarity } }));
}

const GOLD = { body: "#c99b26", bodyDark: "#87640f", lid: "#e0b73a", band: "#ffe066", metal: "#fff3b0" };

// A big gold chest that shakes, flips its lid open with a flash, bursts coins,
// and pops the amount. Mounted once (Providers); auto-dismisses (~2.6s).
export function ChestReward() {
  const [reward, setReward] = useState<Reward | null>(null);

  useEffect(() => {
    const onClaim = (e: Event) => {
      const d = (e as CustomEvent).detail as Reward | undefined;
      if (d?.amount) setReward(d);
    };
    window.addEventListener("gd:claim-success", onClaim);
    return () => window.removeEventListener("gd:claim-success", onClaim);
  }, []);

  useEffect(() => {
    if (!reward) return;
    const t = setTimeout(() => setReward(null), 2700);
    return () => clearTimeout(t);
  }, [reward]);

  // Coin particles — fixed spread so it looks intentional, not random noise.
  const coins = [
    { dx: -66, dy: -96 }, { dx: -30, dy: -120 }, { dx: 4, dy: -128 },
    { dx: 38, dy: -118 }, { dx: 70, dy: -92 }, { dx: -50, dy: -70 }, { dx: 54, dy: -66 },
  ];

  return (
    <AnimatePresence>
      {reward && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => setReward(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 5000,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: "rgba(8,8,10,0.72)", backdropFilter: "blur(3px)",
            fontFamily: "'Space Grotesk', sans-serif", pointerEvents: "auto",
          }}
        >
          <motion.div
            initial={{ scale: 0.5, y: 20 }} animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", damping: 16, stiffness: 300 }}
            style={{ position: "relative", width: 180, height: 180 }}
          >
            {/* radial flash */}
            <div className="chest-reward-flash" style={{
              position: "absolute", inset: "-30%", borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255,225,120,0.9), rgba(255,225,120,0) 60%)",
            }} />

            {/* coins */}
            {coins.map((c, i) => (
              <span key={i} className="chest-reward-coin" style={{
                position: "absolute", left: "50%", top: "42%", fontSize: 26,
                // @ts-expect-error CSS custom props
                "--dx": `${c.dx}px`, "--dy": `${c.dy}px`,
                marginLeft: -13, animationDelay: `${0.7 + i * 0.04}s`,
              }}>🪙</span>
            ))}

            {/* chest */}
            <div className="chest-reward-shake" style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 6px 16px rgba(0,0,0,.5)) drop-shadow(0 0 22px rgba(255,215,0,.55))" }}>
              <svg width="180" height="180" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
                {/* body */}
                <rect x="16" y="46" width="64" height="38" rx="5" fill={GOLD.body} stroke={GOLD.bodyDark} strokeWidth="2.5" />
                <rect x="11" y="46" width="74" height="9" rx="2.5" fill={GOLD.band} />
                <rect x="27" y="46" width="5" height="38" fill={GOLD.band} opacity="0.9" />
                <rect x="64" y="46" width="5" height="38" fill={GOLD.band} opacity="0.9" />
                <rect x="41" y="47" width="14" height="17" rx="3" fill={GOLD.metal} stroke={GOLD.bodyDark} strokeWidth="1.4" />
                <circle cx="48" cy="54" r="2.6" fill={GOLD.bodyDark} />
                {/* lid — hinges open */}
                <g className="chest-reward-lid">
                  <path d="M16 48 Q16 22 48 22 Q80 22 80 48 Z" fill={GOLD.lid} stroke={GOLD.bodyDark} strokeWidth="2.5" />
                  <path d="M24 40 Q28 28 48 27" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" />
                  <path d="M48 16 l6 5.5 -6 6 -6 -6 z" fill="#ff5d8f" stroke="#fff" strokeWidth="1.2" />
                </g>
              </svg>
            </div>
          </motion.div>

          <div className="chest-reward-amount" style={{ marginTop: 8, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 40, fontWeight: 900, color: "#BFFD00", lineHeight: 1, textShadow: "0 2px 12px rgba(191,253,0,.5)" }}>
              +{reward.amount} G$
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Claimed! 🎉
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
