"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Award } from "lucide-react";
import { badgeArt } from "@/components/profile/badgeArt";

interface EarnedBadge { id?: string; name: string; emoji: string }

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

// Global toast: "Badge unlocked". Mounted once in Providers.
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
  const art = current?.id ? badgeArt(current.id) : null;

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.name}
          initial={{ opacity: 0, y: -24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.95 }}
          transition={{ type: "spring", damping: 22, stiffness: 380 }}
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 z-[4500] pointer-events-none font-sans
            flex items-center gap-3 bg-white rounded-full p-2 pr-5
            shadow-[0px_4px_24px_0px_#00000014] max-w-[calc(100vw-24px)]"
          style={{ top: "calc(var(--spacing-nav) + 12px + env(safe-area-inset-top))" }}
        >
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} alt="" className="w-11.5 h-11.5 shrink-0 object-contain" />
          ) : (
            <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center">
              <Award className="w-5 h-5" strokeWidth={1.75} />
            </span>
          )}
          <div className="min-w-0 flex flex-col gap-y-1">
            <p className="text-xs/none text-nav-muted">Badge unlocked</p>
            <p className="text-base/none text-heading truncate">{current.name}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
