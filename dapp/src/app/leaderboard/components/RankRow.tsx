"use client";
import { memo } from "react";
import { EntryIdentity, EntryAmount } from "./Entry";
import { RankBadge } from "./RankBadge";
import { IdentitySkeleton, AmountSkeleton, Skeleton } from "./Skeleton";
import { amountG } from "./format";
import { openProfile } from "@/components/profile/ProfileDrawer";
import type { Rank } from "./types";

interface Props {
  rank: number;
  entry: Rank;
  unit: string;
  /** Tints the row when it's the connected wallet. */
  isMe?: boolean;
  /**
   * Extra classes on the row ITSELF. The mobile top-three need `lg:hidden`, and
   * wrapping them in a hidden div instead would make each row the only child of
   * its wrapper — so `last:border-0` would match every one of them and strip the
   * separator from all three.
   */
  className?: string;
}

/**
 * Memoised: `entry` objects are rebuilt only when drops or identity roots change,
 * and every other prop is a primitive — so typing in the search box re-renders
 * the page without touching a single row.
 */
export const RankRow = memo(function RankRow({ rank, entry, unit, isMe = false, className = "" }: Props) {
  // Below lg the podium collapses into rows, so ranks 1–3 render a medal here
  // instead of the ordinal chip (matching RankBadge's own condition).
  //
  // Slot width is the thing to hold constant, or the avatars and names down the
  // column stop lining up:
  //   mobile  — chip 46 + 2×17 = 80 · medal 80 flush = 80
  //   desktop — chip 46 + 2×23 = 92 · medal 46 + 2×23 = 92
  const showsMedal = rank <= 3 && !isMe;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openProfile(entry.address, rank)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile(entry.address, rank); } }}
      className={`border-b border-line last:border-0 flex justify-between items-center gap-3 pr-6 cursor-pointer
        motion-safe:transition-colors ${isMe ? "bg-brand-soft/40" : "hover:bg-surface/60"} ${className}`}
    >
      <div className="flex items-center min-w-0">
        <div className={`shrink-0 ${showsMedal ? "p-0 lg:p-5.75" : "p-[17px] lg:p-5.75"}`}>
          <RankBadge rank={rank} highlight={isMe} />
        </div>
        <EntryIdentity address={entry.address} count={entry.count} unit={unit} />
      </div>
      <EntryAmount value={amountG(entry.totalWei)} />
    </div>
  );
});

export function RankRowSkeleton() {
  return (
    <div className="border-b border-line last:border-0 flex justify-between items-center gap-3 pr-6">
      <div className="flex items-center min-w-0">
        <div className="p-5.75 shrink-0">
          <Skeleton className="w-11.5 h-11.5" />
        </div>
        <IdentitySkeleton />
      </div>
      <AmountSkeleton />
    </div>
  );
}
