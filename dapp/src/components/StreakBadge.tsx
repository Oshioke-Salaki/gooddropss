"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import type { HunterStreak } from "@/types";

/**
 * Compact always-visible hunting-streak badge (🔥 N) for the nav.
 * Renders nothing until a streak of ≥1 is confirmed, so it never shows a
 * distracting "0". Refreshes when the address changes or a claim fires the
 * `gd:streak-updated` event.
 */
export function StreakBadge() {
  const { address } = useAccount();
  const { authenticated } = useAuth();
  // Privy is authoritative — wagmi can report a stale address after logout.
  const signedInAddress = authenticated && address ? address : null;
  const [streak, setStreak] = useState<HunterStreak | null>(null);

  useEffect(() => {
    if (!signedInAddress) { setStreak(null); return; }
    let cancelled = false;

    const load = () => {
      fetch(`/api/engagement?address=${signedInAddress}`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled && d.streak) setStreak(d.streak); })
        .catch(() => {});
    };

    load();
    window.addEventListener("gd:streak-updated", load);
    return () => { cancelled = true; window.removeEventListener("gd:streak-updated", load); };
  }, [signedInAddress]);

  if (!streak || streak.current < 1) return null;

  const hot = streak.current >= 7;

  return (
    <div
      title={`${streak.current}-day hunting streak · best ${streak.best}`}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        background: hot ? "#FF6400" : "#111",
        color: hot ? "#fff" : "#BFFD00",
        border: "2px solid #111",
        borderRadius: 10,
        padding: "5px 9px",
        fontWeight: 900, fontSize: 13,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: 14 }}>🔥</span>
      <span>{streak.current}</span>
    </div>
  );
}
