"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface EarnedBadge { name: string; emoji: string }

// After a successful claim, call this — it re-evaluates badges (which also
// awards them server-side) and fires the celebration banner for anything new.
// Fire-and-forget: never blocks or breaks the claim flow it rides on.
export async function checkBadgesAfterClaim(address: string | undefined) {
  if (!address) return;
  try {
    // fresh=1 + no-store: this runs right after a claim to award + celebrate a new
    // badge, so it must hit the function, never a CDN-cached wall.
    const res = await fetch(`/api/badges?address=${address.toLowerCase()}&fresh=1`, { cache: "no-store" });
    const d = await res.json();
    if (!Array.isArray(d.newlyEarned) || d.newlyEarned.length === 0) return;
    const byId = new Map((d.badges as { id: string; name: string; emoji: string }[]).map((b) => [b.id, b]));
    const earned: EarnedBadge[] = d.newlyEarned
      .map((id: string) => byId.get(id))
      .filter((b: EarnedBadge | undefined): b is EarnedBadge => !!b);
    if (earned.length) {
      window.dispatchEvent(new CustomEvent("gd:badges-earned", { detail: { badges: earned } }));
    }
  } catch { /* silent */ }
}

// Global banner: "🏅 Badge unlocked". Mounted once in Providers.
export function BadgeCelebration() {
  const [queue, setQueue] = useState<EarnedBadge[]>([]);

  useEffect(() => {
    const onEarned = (e: Event) => {
      const badges = (e as CustomEvent).detail?.badges as EarnedBadge[] | undefined;
      if (badges?.length) setQueue((q) => [...q, ...badges]);
    };
    window.addEventListener("gd:badges-earned", onEarned);
    return () => window.removeEventListener("gd:badges-earned", onEarned);
  }, []);

  // Show one at a time, ~3.2s each.
  useEffect(() => {
    if (queue.length === 0) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 3200);
    return () => clearTimeout(t);
  }, [queue]);

  const current = queue[0];

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.name}
          initial={{ opacity: 0, y: -24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.95 }}
          transition={{ type: "spring", damping: 22, stiffness: 380 }}
          style={{
            position: "fixed", left: "50%", transform: "translateX(-50%)",
            top: "calc(72px + env(safe-area-inset-top))", zIndex: 4500,
            display: "flex", alignItems: "center", gap: 10,
            background: "#111", border: "2px solid #BFFD00", borderRadius: 16,
            padding: "10px 16px", boxShadow: "0 10px 34px rgba(0,0,0,0.5)",
            fontFamily: "'Space Grotesk', sans-serif", pointerEvents: "none",
            maxWidth: "calc(100vw - 24px)",
          }}
        >
          <span style={{ fontSize: 26, lineHeight: 1 }}>{current.emoji}</span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#BFFD00" }}>
              Badge unlocked
            </p>
            <p style={{ margin: "1px 0 0", fontSize: 15, fontWeight: 900, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {current.name}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
