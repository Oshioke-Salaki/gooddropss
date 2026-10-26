"use client";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";

/** Grey chip in the identity block: "12/12 Core badges", "77 Referred". */
export function MetaChip({
  icon, value, label, loading,
}: { icon: React.ReactNode; value: string; label: string; loading: boolean }) {
  return (
    <div className="flex gap-3 items-center bg-surface rounded-full py-2.5 px-4 min-w-0">
      <span className="shrink-0 text-heading">{icon}</span>
      {loading ? (
        <Skeleton className="h-[16px] w-10 bg-white" />
      ) : (
        <span className="text-base/none text-heading">{value}</span>
      )}
      <span className="text-sm/none text-nav-muted whitespace-nowrap">{label}</span>
    </div>
  );
}

/** One of the four outlined stat pills. */
export function StatPill({
  icon, value, label, loading,
}: { icon: React.ReactNode; value: string; label: string; loading: boolean }) {
  return (
    <div className="border border-line rounded-full p-2 flex gap-x-4 items-center min-w-0">
      <div className="w-11.5 h-11.5 bg-surface flex justify-center items-center rounded-full shrink-0 text-heading">
        {icon}
      </div>
      <div className="flex flex-col gap-y-1 min-w-0">
        {loading ? (
          <Skeleton className="h-[18px] w-14" />
        ) : (
          <span className="text-lg/none text-heading truncate">{value}</span>
        )}
        <span className="text-sm/none text-nav-muted truncate">{label}</span>
      </div>
    </div>
  );
}

/** Section heading used down the scrollable body. */
export function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-6 pb-6">
      <h3 className="text-lg/none text-heading mb-4">{title}</h3>
      {children}
    </div>
  );
}

const MEDALS = ["/first-medal.svg", "/second-medal.svg", "/third-medal.svg"];

/**
 * The rank flash in the header. Top three get their medal; everyone else gets an
 * ordinal chip. Hidden entirely when the rank isn't known — the drawer can be
 * opened from the wallet modal, where computing it would mean pulling the whole
 * board for one number.
 */
export function RankMedal({ rank }: { rank?: number | null }) {
  if (!rank) return null;
  if (rank <= 3) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={MEDALS[rank - 1]}
        alt={`Rank ${rank}`}
        width={140}
        height={140}
        className="w-28 h-28 lg:w-35 lg:h-35 shrink-0 -mt-6 -mr-2 pointer-events-none select-none"
      />
    );
  }
  return (
    <div className="font-anta shrink-0 rounded-full bg-surface text-heading w-14 h-14 flex items-center justify-center text-sm">
      {rank}
    </div>
  );
}
