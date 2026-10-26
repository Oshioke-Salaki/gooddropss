"use client";
import { Gift, Target } from "lucide-react";
import type { Tab } from "./types";

const TABS: { id: Tab; label: string; Icon: typeof Gift }[] = [
  { id: "droppers", label: "Droppers", Icon: Gift },
  { id: "hunters", label: "Hunters", Icon: Target },
];

/**
 * Segmented Droppers/Hunters control.
 *
 * The brand pill is one absolutely-positioned element that slides, rather than a
 * background swapped between two buttons — that's what makes the change read as
 * movement instead of a blink.
 *
 * Full-bleed on mobile (each cell takes half the bar), a fixed 140px per cell at
 * lg. The travel is `translateX(100%)` — the pill's OWN width — which is exactly
 * one cell at both sizes, so a single inline transform covers both breakpoints.
 */
export function LeaderboardToggle({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  const index = TABS.findIndex((t) => t.id === tab);

  return (
    <div
      role="tablist"
      aria-label="Leaderboard"
      className="relative bg-white rounded-full p-1 flex items-center w-full lg:w-fit shrink-0 mx-auto lg:mx-0"
    >
      <div
        aria-hidden
        className="absolute top-1 left-1 h-10 w-[calc(50%-4px)] lg:w-35 rounded-full bg-brand
          motion-safe:transition-transform motion-safe:duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          onClick={() => onChange(id)}
          className={`relative z-10 h-10 flex-1 lg:flex-none lg:w-35 flex items-center justify-center gap-x-3.5 rounded-full text-sm/none cursor-pointer
            motion-safe:transition-colors ${tab === id ? "text-white" : "text-nav-muted hover:text-heading"}`}
        >
          <Icon size={18} strokeWidth={1.75} className="shrink-0" />
          {label}
        </button>
      ))}
    </div>
  );
}
