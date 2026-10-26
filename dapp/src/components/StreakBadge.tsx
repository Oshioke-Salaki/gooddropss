"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import type { HunterStreak } from "@/types";
import { StreakCelebration, seedStreakMilestones, takeStreakMilestone } from "@/components/StreakCelebration";

/**
 * Compact always-visible hunting-streak badge (flame + N) for the nav.
 *
 * Shows a small spinner while the first fetch is in flight, so the grey nav pill
 * isn't half-empty for a second before the streak pops in. Subsequent refreshes
 * (fired by `gd:streak-updated` after a claim) keep the current value on screen
 * rather than flashing back to a spinner.
 *
 * Renders nothing once we know the streak is 0, so we never show a dispiriting "0".
 */
export function StreakBadge() {
  const { address } = useAccount();
  const { authenticated } = useAuth();
  // Auth is authoritative — wagmi can report a stale address after logout.
  const signedInAddress = authenticated && address ? address : null;
  const [streak, setStreak] = useState<HunterStreak | null>(null);
  const [loading, setLoading] = useState(false);
  const [milestone, setMilestone] = useState<number | null>(null);
  const clearMilestone = useCallback(() => setMilestone(null), []);

  useEffect(() => {
    if (!signedInAddress) { setStreak(null); setLoading(false); return; }
    let cancelled = false;
    let celebrate: ReturnType<typeof setTimeout> | undefined;

    // `afterClaim` is true only for refreshes fired by a claim. The first load
    // just records milestones already passed, so opening the app with a long
    // streak doesn't throw a toast.
    const load = (afterClaim: boolean) => {
      setLoading(true);
      fetch(`/api/engagement?address=${signedInAddress}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d.streak) return;
          setStreak(d.streak);
          const current = Number(d.streak.current) || 0;
          if (!afterClaim) { seedStreakMilestones(signedInAddress, current); return; }
          const hit = takeStreakMilestone(signedInAddress, current);
          // Let a badge toast (fired by the same claim) finish first.
          if (hit) celebrate = setTimeout(() => setMilestone(hit), 3400);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    const onUpdated = () => load(true);

    load(false);
    window.addEventListener("gd:streak-updated", onUpdated);
    return () => {
      cancelled = true;
      if (celebrate) clearTimeout(celebrate);
      window.removeEventListener("gd:streak-updated", onUpdated);
    };
  }, [signedInAddress]);

  // Signed out — the nav renders no pill at all, so show nothing.
  if (!signedInAddress) return null;

  // Spinner only while we have nothing to show yet — never over a live value.
  if (loading && !streak) {
    return (
      <div className="flex items-center justify-center w-4 shrink-0" aria-label="Loading streak">
        <Loader2 size={14} className="animate-spin text-nav-muted" />
      </div>
    );
  }

  // The slot is permanent: a 0 streak shows a dimmed flame + 0 rather than
  // collapsing, so the pill never changes width once loaded.
  const current = streak?.current ?? 0;
  const dim = current < 1;

  return (
    <>
    <StreakCelebration milestone={milestone} onDone={clearMilestone} />
    <div
      title={dim
        ? "No hunting streak yet — claim a drop to start one"
        : `${current}-day hunting streak · best ${streak?.best ?? current}`}
      className={`flex items-center gap-2 whitespace-nowrap ${dim ? "opacity-40" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/streak-flame.svg" alt="" width={16} height={16} className="shrink-0" />
      <span className="text-base font-normal leading-none text-nav-active">{current}</span>
    </div>
    </>
  );
}
