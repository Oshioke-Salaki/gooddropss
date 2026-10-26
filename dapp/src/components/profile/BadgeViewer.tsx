"use client";
import { X } from "lucide-react";
import { Medal, Lock } from "lucide-react";
import { useEffect } from "react";
import { BadgeFace } from "./BadgeGrid";
import type { WallBadge } from "./useHunterProfile";

interface Props {
  badge: WallBadge;
  onClose: () => void;
}

/**
 * The single-badge view.
 *
 * Sits to the LEFT of the drawer on desktop and as a centred card on mobile,
 * because the drawer itself already owns the bottom of a phone screen. It's
 * rendered by the drawer host (not inside the drawer's scroll container) so it
 * stays put while the wall scrolls behind it.
 */
export function BadgeViewer({ badge, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Stop here: closing the badge shouldn't also close the drawer behind it.
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={badge.name}
      className="viewer-in-lg w-[calc(100vw-32px)] max-w-[420px] lg:w-[420px] bg-white rounded-3xl p-6
        shadow-[0px_0px_12px_0px_#0000000A] max-h-[80dvh] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-3 mb-6">
        <span
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm/none ${
            badge.earned ? "bg-brand-soft text-brand" : "bg-surface text-nav-muted"
          }`}
        >
          {badge.earned ? <Medal className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          {badge.earned ? "Earned" : "Locked"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close badge"
          className="w-8 h-8 shrink-0 rounded-full bg-surface text-nav-muted flex items-center justify-center
            cursor-pointer motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex justify-center mb-6">
        <BadgeFace badge={badge} size="large" />
      </div>

      <h3 className="text-xl/none text-heading mb-3">{badge.name}</h3>
      <p className="text-base/[150%] text-nav-muted">{badge.description}</p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-surface px-3 py-2 text-sm/none text-nav-muted">
          Held by {badge.holders.toLocaleString("en-US")}
        </span>
        {badge.earned && badge.earnedAt && (
          <span className="rounded-full bg-surface px-3 py-2 text-sm/none text-nav-muted">
            Earned {new Date(badge.earnedAt * 1000).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
        {badge.minted && (
          <span className="rounded-full bg-brand-soft px-3 py-2 text-sm/none text-brand">
            Saved to wallet
          </span>
        )}
      </div>
    </div>
  );
}
