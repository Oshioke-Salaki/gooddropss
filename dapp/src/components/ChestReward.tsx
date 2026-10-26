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
          role="status"
          aria-live="assertive"
          // Dark glass on purpose: this is the one full-screen "you won" beat, and
          // the gold chest needs contrast to glow.
          className="fixed inset-0 z-[5000] flex flex-col items-center justify-center font-sans
            bg-[#121607]/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.5, y: 20 }} animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", damping: 16, stiffness: 300 }}
            className="relative w-[180px] h-[180px]"
          >
            {/* radial flash */}
            <div
              className="chest-reward-flash absolute -inset-[30%] rounded-full"
              style={{ background: "radial-gradient(circle, rgba(255,225,120,0.9), rgba(255,225,120,0) 60%)" }}
            />

            {/* coins */}
            {coins.map((c, i) => (
              <span
                key={i}
                className="chest-reward-coin absolute left-1/2 top-[42%] -ml-2.5 w-5 h-5 rounded-full
                  bg-[#FFD700] border-2 border-[#c99b26] shadow-[inset_0_-2px_0_#e0b73a]"
                style={{
                  // @ts-expect-error CSS custom props
                  "--dx": `${c.dx}px`, "--dy": `${c.dy}px`,
                  animationDelay: `${0.7 + i * 0.04}s`,
                }}
              />
            ))}

            {/* chest */}
            <div
              className="chest-reward-shake absolute inset-0"
              style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,.5)) drop-shadow(0 0 22px rgba(255,215,0,.55))" }}
            >
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

          <div className="chest-reward-amount mt-2 text-center">
            <p className="font-anta text-[40px]/none text-white" style={{ textShadow: "0 2px 12px rgba(255,215,0,.45)" }}>
              +{reward.amount} G$
            </p>
            <p className="mt-2 text-sm/none text-white/80">Claimed</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
