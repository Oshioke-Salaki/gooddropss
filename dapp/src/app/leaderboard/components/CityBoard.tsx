"use client";
import { Crown, MapPin, RotateCw } from "lucide-react";
import { amountG, fullG } from "./format";
import { RankBadge, ordinal } from "./RankBadge";

const MEDALS = ["/second-medal.svg", "/third-medal.svg"];
import { Skeleton } from "./Skeleton";
import { resetsIn } from "@/lib/cities";
import type { CityRank } from "../useCityBoard";

/**
 * City vs city: this week's G$ found per city. The leader wears the crown; each
 * row's bar shows how close it is to first; your own city (when we know it) is
 * tinted so you can find it at a glance.
 */
export function CityBoard({ rows, loading, error, myCity, endsAt, onRetry }: {
  rows: CityRank[];
  loading: boolean;
  error: boolean;
  myCity: string | null;
  endsAt: number | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="border-t border-line" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="border-b border-line last:border-0 flex items-center gap-4 p-5 lg:px-6">
            <Skeleton className="w-11.5 h-11.5 shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-2.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-2 w-full" /></div>
            <Skeleton className="h-6 w-20 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-line px-6 py-20 text-center flex flex-col items-center" role="alert">
        <p className="text-lg/none text-heading mb-3">Couldn&apos;t load the cities</p>
        <p className="text-sm/[140%] text-nav-muted mb-6">Check your connection and try again.</p>
        <button type="button" onClick={onRetry}
          className="h-11 px-6 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90">
          <RotateCw className="w-4 h-4" strokeWidth={2} /> Try again
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border-t border-line px-6 py-20 text-center">
        <p className="text-lg/none text-heading mb-3">No finds yet this week</p>
        <p className="text-sm/[140%] text-nav-muted">The first city to find a drop takes the crown.</p>
      </div>
    );
  }

  const top = rows[0].foundWei > 0n ? rows[0].foundWei : 1n;
  return (
    <div className="border-t border-line">
      {endsAt && (
        <p className="px-5 lg:px-6 pt-4 pb-1 text-xs/none text-nav-muted">This week · {resetsIn(endsAt)}</p>
      )}
      <ol aria-label="Cities this week">
        {rows.map((r, i) => {
          const rank = i + 1;
          const mine = r.id === myCity;
          const pct = Number((r.foundWei * 1000n) / top) / 10;
          return (
            <li key={r.id}
              className={`border-b border-line last:border-0 flex items-center gap-3 lg:gap-4 px-4 py-4 lg:px-6
                motion-safe:transition-colors ${mine ? "bg-brand-soft/40" : "hover:bg-surface/60"}`}>
              <div className="shrink-0 w-11.5 flex justify-center">
                {rank === 1
                  ? <span className="w-11.5 h-11.5 rounded-full bg-[#FFF4D1] text-[#B8860B] flex items-center justify-center" aria-label="1st">
                      <Crown className="w-5 h-5" strokeWidth={2} />
                    </span>
                  : (rank === 2 || rank === 3) && !mine
                    // Same 46px slot as the crown and the ordinal chips at every width.
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={MEDALS[rank - 2]} alt={ordinal(rank)} width={46} height={46} className="w-11.5 h-11.5 object-contain" />
                    : <RankBadge rank={rank} highlight={mine} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-base/none text-heading truncate">{r.name}</p>
                  {mine && (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-brand text-white text-[11px]/none px-2 py-1">
                      <MapPin className="w-3 h-3" strokeWidth={2.25} /> You
                    </span>
                  )}
                </div>
                <div className="mt-2.5 h-1.5 rounded-full bg-surface overflow-hidden" aria-hidden>
                  <div className={`h-full rounded-full ${rank === 1 ? "bg-[#F5B400]" : "bg-brand"} motion-safe:transition-[width] motion-safe:duration-700`}
                    style={{ width: `${Math.max(3, pct)}%` }} />
                </div>
                <p className="mt-2 text-xs/none text-nav-muted truncate">
                  {r.claims.toLocaleString("en-US")} {r.claims === 1 ? "find" : "finds"} · {r.hunters.toLocaleString("en-US")} {r.hunters === 1 ? "hunter" : "hunters"}
                  {r.hidden > 0 && <span className="hidden lg:inline"> · {r.hidden.toLocaleString("en-US")} hidden</span>}
                  {r.country !== "Nigeria" && <> · {r.country}</>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg/none lg:text-xl/none text-heading tabular-nums" title={`${fullG(r.foundWei)} G$`}>
                  {amountG(r.foundWei)} <span className="text-xs text-nav-muted">G$</span>
                </p>
                <p className="mt-1.5 text-[11px]/none text-nav-muted">found</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
