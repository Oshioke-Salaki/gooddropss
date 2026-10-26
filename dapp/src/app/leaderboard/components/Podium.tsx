"use client";
import { EntryIdentity, EntryAmount } from "./Entry";
import { IdentitySkeleton, AmountSkeleton } from "./Skeleton";
import { amountG } from "./format";
import { openProfile } from "@/components/profile/ProfileDrawer";
import type { Rank } from "./types";

const MEDALS = ["/first-medal.svg", "/second-medal.svg", "/third-medal.svg"];

function Cell({ medal, children, onClick }: { medal: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      {...(onClick ? { role: "button", tabIndex: 0, onClick,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } } : {})}
      className={`flex-1 flex items-center min-w-0 border-b lg:border-b-0 lg:border-r border-line last:border-0
        motion-safe:transition-colors ${onClick ? "cursor-pointer hover:bg-surface/60" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={medal} alt="" width={140} height={140} className="w-20 h-20 lg:w-35 lg:h-35 shrink-0" />
      <div className="flex-1 pr-6 flex justify-between items-center gap-3 min-w-0">{children}</div>
    </div>
  );
}

/**
 * Top three, side by side on desktop and stacked on mobile. Medals are 80px
 * below lg and 140px above — `width`/`height` carry the intrinsic 140 so the
 * browser reserves the right box before the SVG lands.
 *
 * Rendered only when all three exist — a half-empty podium with two medals and a
 * gap looks broken, so a board with fewer than three entries lists everyone as
 * ordinary rows instead.
 */
export function Podium({
  entries,
  unit,
  loading,
}: {
  entries: Rank[];
  unit: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="border-y border-line flex flex-col lg:flex-row">
        {MEDALS.map((m) => (
          <Cell key={m} medal={m}>
            <IdentitySkeleton />
            <AmountSkeleton />
          </Cell>
        ))}
      </div>
    );
  }

  return (
    <div className="border-y border-line flex flex-col lg:flex-row">
      {entries.map((entry, i) => (
        <Cell key={entry.address} medal={MEDALS[i]} onClick={() => openProfile(entry.address, i + 1)}>
          <EntryIdentity address={entry.address} count={entry.count} unit={unit} />
          <EntryAmount value={amountG(entry.totalWei)} />
        </Cell>
      ))}
    </div>
  );
}
