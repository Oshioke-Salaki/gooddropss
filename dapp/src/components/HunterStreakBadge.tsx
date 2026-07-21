"use client";
import { useEffect, useState } from "react";
import type { HunterStreak } from "@/types";

/**
 * Hunting-streak pill for a hunter profile, keyed by the profile's address (not
 * the connected wallet). Renders nothing until a streak of ≥1 is confirmed.
 */
export function HunterStreakBadge({ address }: { address: string }) {
  const [streak, setStreak] = useState<HunterStreak | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/engagement?address=${address}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.streak) setStreak(d.streak); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [address]);

  if (!streak || streak.current < 1) return null;
  const hot = streak.current >= 7;

  return (
    <div
      title={`${streak.current}-day hunting streak · best ${streak.best}`}
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-xs font-black shadow-brutal-sm"
      style={{ background: hot ? "#FF6400" : "#111", color: hot ? "#fff" : "#BFFD00" }}
    >
      <span>🔥</span>
      <span>{streak.current}-day streak</span>
    </div>
  );
}
