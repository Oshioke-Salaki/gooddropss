"use client";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { badgeArt } from "./badgeArt";
import type { WallBadge } from "./useHunterProfile";

/** One badge face. Illustration when we have one, emoji until the art lands. */
export function BadgeFace({ badge, size = "grid" }: { badge: WallBadge; size?: "grid" | "large" }) {
  const art = badgeArt(badge.id);
  const box = size === "large" ? "w-[280px] h-[280px] max-w-full" : "w-full aspect-square";

  if (art) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={art}
        alt=""
        className={`${box} object-contain ${badge.earned ? "" : "grayscale opacity-40"}`}
      />
    );
  }
  return (
    <div
      className={`${box} rounded-full bg-surface flex items-center justify-center
        ${size === "large" ? "text-8xl" : "text-4xl"} ${badge.earned ? "" : "grayscale opacity-40"}`}
    >
      {badge.emoji}
    </div>
  );
}

interface Props {
  badges: WallBadge[] | null;
  selectedId: string | null;
  onSelect: (badge: WallBadge) => void;
}

/**
 * The badge wall.
 *
 * Earned first, then locked — the locked ones stay visible (greyed) because the
 * path to the next badge is the point of the wall, not clutter. Every tile is a
 * button: tapping opens the viewer with the full description.
 */
export function BadgeGrid({ badges, selectedId, onSelect }: Props) {
  if (badges === null) {
    return (
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-x-2 gap-y-4">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="p-3 flex flex-col items-center gap-2">
            <Skeleton className="w-full aspect-square" />
            <Skeleton className="h-[14px] w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (badges.length === 0) {
    return <p className="text-sm/[140%] text-nav-muted">No badges yet — claim a drop to start.</p>;
  }

  const ordered = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned));

  return (
    <div className="grid grid-cols-3 lg:grid-cols-5 gap-x-2 gap-y-2">
      {ordered.map((badge) => (
        <button
          key={badge.id}
          type="button"
          onClick={() => onSelect(badge)}
          aria-pressed={selectedId === badge.id}
          title={badge.description}
          className={`p-3 rounded-2xl flex flex-col items-center text-center gap-2 cursor-pointer
            motion-safe:transition-colors ${selectedId === badge.id ? "bg-surface" : "hover:bg-surface/60"}`}
        >
          <BadgeFace badge={badge} />
          <span className={`text-sm/[120%] ${badge.earned ? "text-nav-muted" : "text-nav-muted/60"}`}>
            {badge.name}
          </span>
        </button>
      ))}
    </div>
  );
}
