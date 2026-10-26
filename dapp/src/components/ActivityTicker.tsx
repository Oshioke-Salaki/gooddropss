"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Coins, Target } from "lucide-react";
import { fetchRecentActivity, type ActivityItem } from "@/lib/subgraph";
import { formatG$ } from "@/lib/utils";
import { UserHandle } from "@/components/UserHandle";

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3_600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3_600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

/**
 * Live-activity toasts over the map: the latest drops and claims, newest on
 * top, each auto-dismissing. Tapping one dismisses it early.
 */
export function ActivityTicker() {
  const [visible, setVisible] = useState<ActivityItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const seenRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  async function load() {
    const data = await fetchRecentActivity();
    if (!data.length) return;

    const fresh = data.filter((a) => !seenRef.current.has(a.id));
    if (!fresh.length) {
      // On first load, show the 3 most recent with a 6s auto-dismiss
      if (seenRef.current.size === 0) {
        const initial = data.slice(0, 3);
        initial.forEach((a) => seenRef.current.add(a.id));
        setVisible(initial);
        initial.forEach((a) => {
          const t = setTimeout(() => dismiss(a.id), 6_000);
          timerRef.current.set(a.id, t);
        });
      }
      return;
    }

    fresh.forEach((a) => seenRef.current.add(a.id));
    setVisible((prev) => {
      const merged = [...fresh, ...prev].filter((a) => !dismissed.has(a.id));
      return merged.slice(0, 3);
    });

    // Auto-dismiss new items after 9 seconds
    fresh.forEach((a) => {
      const t = setTimeout(() => dismiss(a.id), 9_000);
      timerRef.current.set(a.id, t);
    });
  }

  function dismiss(id: string) {
    const t = timerRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timerRef.current.delete(id);
    }
    setDismissed((prev) => new Set([...prev, id]));
    setVisible((prev) => prev.filter((a) => a.id !== id));
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 20_000);
    const timers = timerRef.current; // same Map for the component's life
    return () => {
      clearInterval(iv);
      timers.forEach(clearTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible.length) return null;

  return (
    // Clipped container: the entrance animates vertically and the box never
    // extends past the viewport edge, so nothing here can widen the page.
    <div
      aria-live="polite"
      className="fixed z-[997] right-3 lg:right-[60px] w-[min(280px,calc(100vw-24px))] overflow-hidden
        flex flex-col items-end gap-2 pointer-events-none font-sans"
      style={{
        // Below the nav and, on phones, below the full-bleed search band.
        top: "calc(var(--spacing-nav) + var(--gd-banner-h, 0px) + 80px)",
        transition: "top 0.2s ease",
      }}
    >
      <AnimatePresence>
        {visible.map((item) => {
          const isDrop = item.type === "drop";
          return (
            <motion.button
              key={item.id}
              type="button"
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ type: "spring", damping: 26, stiffness: 360 }}
              onClick={() => dismiss(item.id)}
              title="Dismiss"
              className="pointer-events-auto max-w-full flex items-center gap-2.5 rounded-full bg-white p-1.5 pr-4
                shadow-[0px_0px_12px_0px_#0000000A] cursor-pointer text-left
                motion-safe:transition-shadow hover:shadow-[0px_2px_12px_0px_#00000014]"
            >
              <span
                className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${
                  isDrop ? "bg-streak-bg text-streak" : "bg-brand-soft text-brand"
                }`}
              >
                {isDrop
                  ? <Coins className="w-4 h-4" strokeWidth={2} />
                  : <Target className="w-4 h-4" strokeWidth={2} />}
              </span>
              <span className="min-w-0 flex flex-col gap-y-1">
                <span className="text-xs/none text-heading truncate">
                  <UserHandle address={item.address} />
                  <span className="text-nav-muted">{isDrop ? " dropped " : " claimed "}</span>
                  {formatG$(item.amount)} G$
                </span>
                <span className="text-[11px]/none text-nav-muted">{timeAgo(item.timestamp)}</span>
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
