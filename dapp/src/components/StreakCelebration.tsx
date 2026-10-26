"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export const STREAK_MILESTONES = [3, 7, 14, 30] as const;

const seenKey = (address: string, n: number) => `gd:streak:milestone:${address.toLowerCase()}:${n}`;

function isSeen(address: string, n: number): boolean {
  try { return localStorage.getItem(seenKey(address, n)) === "1"; } catch { return true; }
}
function markSeen(address: string, n: number) {
  try { localStorage.setItem(seenKey(address, n), "1"); } catch { /* private mode */ }
}

/**
 * Milestones already passed when we first see a streak are marked seen
 * silently — the toast is for reaching one, not for opening the app with a
 * long streak.
 */
export function seedStreakMilestones(address: string, current: number) {
  for (const n of STREAK_MILESTONES) if (current >= n) markSeen(address, n);
}

/** The milestone just reached (and not yet celebrated), or null. Marks it seen. */
export function takeStreakMilestone(address: string, current: number): number | null {
  const hit = STREAK_MILESTONES.find((n) => n === current);
  if (!hit || isSeen(address, hit)) return null;
  markSeen(address, hit);
  return hit;
}

const COPY: Record<number, string> = {
  3: "Three days in a row. You're on a roll.",
  7: "A full week of hunting. Keep it going.",
  14: "Two weeks straight. That's dedication.",
  30: "Thirty days. You're a GoodDrops legend.",
};

/**
 * One-time toast for a streak milestone. Same placement and motion as the
 * badge toast, so the two read as one family; the caller delays it so it
 * follows a badge toast instead of covering it.
 */
export function StreakCelebration({ milestone, onDone }: { milestone: number | null; onDone: () => void }) {
  // Portal only after mount, so server and first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (milestone === null) return;
    const t = setTimeout(onDone, 3600);
    return () => clearTimeout(t);
  }, [milestone, onDone]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {milestone !== null && (
        <motion.div
          key={milestone}
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
          <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-streak-bg flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/streak-flame.svg" alt="" width={22} height={22} />
          </span>
          <div className="min-w-0 flex flex-col gap-y-1">
            <p className="text-xs/none text-streak">{milestone}-day streak</p>
            <p className="text-sm/[130%] text-heading">{COPY[milestone]}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
