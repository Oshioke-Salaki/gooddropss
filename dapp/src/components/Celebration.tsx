"use client";
import { useEffect, useMemo } from "react";

interface Props {
  /** Fire the confetti + haptic once when this flips to true. */
  active: boolean;
  /** Confetti colors — defaults to the brand palette. */
  colors?: string[];
  /** Number of confetti pieces. */
  count?: number;
}

const DEFAULT_COLORS = ["#BFFD00", "#FF6400", "#00CFFF", "#FFD700", "#FF3B6B", "#111111"];

/**
 * Full-screen confetti burst + haptic buzz. Renders nothing until `active`.
 * Purely presentational and self-cleaning — the CSS animation runs `forwards`
 * and the whole layer is removed when `active` goes back to false.
 */
export function Celebration({ active, colors = DEFAULT_COLORS, count = 44 }: Props) {
  // Precompute each piece's randomized style once so re-renders don't reshuffle.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        color: colors[i % colors.length],
        delay: Math.random() * 0.25,
        duration: 1.6 + Math.random() * 1.6,
        rounded: Math.random() > 0.5,
        scale: 0.7 + Math.random() * 0.8,
      })),
    [count, colors],
  );

  // Haptic feedback on fire (mobile only; silently ignored on desktop).
  useEffect(() => {
    if (active && typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.([0, 40, 30, 60]);
    }
  }, [active]);

  if (!active) return null;

  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 3000, pointerEvents: "none", overflow: "hidden" }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            borderRadius: p.rounded ? "50%" : "2px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `scale(${p.scale})`,
          }}
        />
      ))}
    </div>
  );
}
