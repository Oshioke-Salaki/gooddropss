"use client";
import { EntryIdentity, EntryAmount } from "./Entry";
import { RankBadge } from "./RankBadge";
import { amountG } from "./format";
import { openProfile } from "@/components/profile/ProfileDrawer";
import type { Rank } from "./types";

interface Props {
  rank: number;
  entry: Rank;
  unit: string;
  /** True once we've confirmed the wallet has no username — offers to set one. */
  needsName: boolean;
}

/**
 * Your own standing, pinned above the fold of the viewport.
 *
 * Dark and translucent so the board reads through it — which is also why the
 * text here is white rather than the `--color-heading` used in the table.
 */
export function MeBar({ rank, entry, unit, needsName }: Props) {
  return (
    <div
      className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[900] w-[340px] lg:w-100 max-w-[calc(100vw-32px)]
        bg-[#00113866] backdrop-blur-md rounded-full py-2.25 pl-2.25 pr-6
        flex justify-between items-center gap-3 shadow-[0px_0px_12px_0px_#00000014]"
    >
      <div className="flex items-center gap-x-2 min-w-0">
        <RankBadge rank={rank} highlight />
        <EntryIdentity
          address={entry.address}
          count={entry.count}
          unit={unit}
          onDark
          nameOverride="You"
          onOpen={() => openProfile(entry.address, rank)}
        />
      </div>

      {needsName ? (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("gd:setName"))}
          className="shrink-0 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 text-sm/none text-white
            whitespace-nowrap cursor-pointer motion-safe:transition-colors"
        >
          Set your name
        </button>
      ) : (
        <EntryAmount value={amountG(entry.totalWei)} onDark />
      )}
    </div>
  );
}
