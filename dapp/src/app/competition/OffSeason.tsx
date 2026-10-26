"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Map, Trophy, History } from "lucide-react";
import {
  COMP_DEFAULT, REF_COMP_DEFAULT, compPhase, inRefCompWindow,
  type CompConfig, type RefCompConfig,
} from "@/lib/competition";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";

export interface SeasonStatus {
  /** True while either the points or the referral competition is inside its window. */
  live: boolean;
  /** Something has run before — there are standings worth looking back at. */
  hasPast: boolean;
}

/**
 * Is a season running right now?
 *
 * Reads the live configs (the admin can move dates from the dashboard), falling
 * back to the compiled defaults if the API is unreachable, so the page always
 * resolves to an answer. `null` while loading.
 */
export function useSeasonStatus(): SeasonStatus | null {
  const [status, setStatus] = useState<SeasonStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [points, refs] = await Promise.all([
        fetch("/api/comp/config").then((r) => (r.ok ? (r.json() as Promise<CompConfig>) : null)).catch(() => null),
        fetch("/api/comp/referrals/config").then((r) => (r.ok ? (r.json() as Promise<RefCompConfig>) : null)).catch(() => null),
      ]);
      if (cancelled) return;
      const p = points ?? COMP_DEFAULT;
      const r = refs ?? REF_COMP_DEFAULT;
      const now = Math.floor(Date.now() / 1000);
      setStatus({
        live: compPhase(p, now) === "live" || inRefCompWindow(r, now),
        hasPast: now >= p.endsAt || now >= r.endsAt,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  return status;
}

/**
 * The between-seasons state. The boards and all their logic stay in the tree
 * (PointsBoard / ReferralBoard) and come back the moment a window opens — this
 * is what people see in the meantime, instead of a finished leaderboard.
 */
export function OffSeasonCard({ hasPast, onShowPast }: { hasPast: boolean; onShowPast: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[560px] bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 lg:p-8 flex flex-col items-center text-center">
      <span className="w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
        <Trophy className="w-7 h-7" strokeWidth={1.75} />
      </span>
      <h2 className="text-xl/none text-heading mt-5">No competition running right now</h2>
      <p className="text-sm/[150%] text-nav-muted mt-3 max-w-[420px]">
        Seasons are short, real-money sprints with a G$ prize pool for the top droppers,
        hunters and recruiters. The next one is announced here and on X. Until then,
        every drop and find still counts toward your streak, badges and the rankings.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 mt-6 w-full sm:w-auto">
        <Link
          href="/"
          className="h-12 px-6 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2
            motion-safe:transition-colors hover:bg-brand/90"
        >
          <Map className="w-[18px] h-[18px]" strokeWidth={1.75} />
          Back to the map
        </Link>
        {hasPast && (
          <button
            type="button"
            onClick={onShowPast}
            className="h-12 px-6 rounded-full border border-line bg-white text-base/none text-heading
              flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface"
          >
            <History className="w-[18px] h-[18px]" strokeWidth={1.75} />
            Last season&apos;s standings
          </button>
        )}
      </div>
    </div>
  );
}

export function OffSeasonSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[560px] bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 lg:p-8 flex flex-col items-center">
      <Skeleton className="w-16 h-16" />
      <Skeleton className="h-5 w-64 mt-5" />
      <Skeleton className="h-4 w-80 mt-4" />
      <Skeleton className="h-4 w-72 mt-2" />
      <Skeleton className="h-12 w-44 mt-6" />
    </div>
  );
}
