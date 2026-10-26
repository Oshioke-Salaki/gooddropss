"use client";
import Link from "next/link";
import { Clock, MapPin, Navigation } from "lucide-react";
import { eventPhase } from "@/lib/events";
import { haversineDistance } from "@/lib/utils";
import { CATEGORY_ICON, BudgetBar, PhasePill } from "./Pieces";
import { distanceLabel, formatWhen, relativeLine, shortG } from "./format";
import type { EventRow } from "./useEvents";

const G = 10n ** 18n;
const toG = (wei: string) => Number(BigInt(wei || "0") / G);

/**
 * One event in a list. The whole card is the link; numbers are the ones a
 * hunter decides on: when, where, how much G$, and whether it's busy.
 */
export function EventCard({
  row, now, here, loud = false,
}: {
  row: EventRow;
  now: number;
  here?: { lat: number; lng: number } | null;
  loud?: boolean;
}) {
  const { event: e, stats: s } = row;
  const phase = eventPhase(e, now);
  const Icon = CATEGORY_ICON[e.category];
  const dropped = toG(s.droppedWei);
  const claimed = toG(s.claimedWei);
  const dist = here ? haversineDistance(here.lat, here.lng, e.lat, e.lng) : null;

  return (
    <Link
      href={`/events/${e.id}`}
      className={`group block bg-white rounded-3xl p-5 shadow-[0px_0px_12px_0px_#0000000A] min-w-0
        motion-safe:transition-shadow hover:shadow-[0px_6px_24px_0px_#0000001A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40
        ${loud ? "ring-2 ring-brand/15" : ""}`}
    >
      <div className="flex items-start gap-4">
        <span className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center ${phase === "live" ? "bg-brand text-white" : "bg-surface text-heading"}`}>
          <Icon className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <PhasePill phase={phase} label={phase === "live" ? "Live now" : undefined} />
            <span className="text-sm/none text-nav-muted">{relativeLine(phase, e.startsAt, e.endsAt, now)}</span>
          </div>
          <h3 className="mt-3 text-lg/[1.25] text-heading line-clamp-2 group-hover:text-brand motion-safe:transition-colors">{e.title}</h3>
          <div className="mt-2 flex flex-col gap-1.5 text-sm/[1.3] text-nav-muted">
            <span className="flex items-center gap-1.5 min-w-0"><Clock className="w-3.5 h-3.5 shrink-0" />{formatWhen(e.startsAt)}</span>
            <span className="flex items-center gap-1.5 min-w-0">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{e.venueName}</span>
              {dist !== null && <span className="shrink-0 flex items-center gap-1 text-heading"><Navigation className="w-3 h-3" />{distanceLabel(dist)}</span>}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-base/none text-heading">
            <span className="font-anta">{e.budgetG.toLocaleString("en-US")}</span> <span className="text-brand">G$</span>
            <span className="text-sm text-nav-muted"> budget</span>
          </span>
          <span className="text-xs/none text-nav-muted">{shortG(dropped)} dropped · {shortG(claimed)} found</span>
        </div>
        <BudgetBar budgetG={e.budgetG} droppedG={dropped} claimedG={claimed} />
      </div>

      {/* Only the numbers that mean something in this phase. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {phase === "upcoming" && (
          <>
            {s.live > 0 && <Chip>{s.live} {s.live === 1 ? "drop waiting" : "drops waiting"}</Chip>}
            <Chip>{row.interested ?? 0} interested</Chip>
          </>
        )}
        {phase === "live" && (
          <>
            <Chip strong>{s.live} {s.live === 1 ? "live drop" : "live drops"}</Chip>
            <Chip>{s.hunters} {s.hunters === 1 ? "person found G$" : "people found G$"}</Chip>
          </>
        )}
        {phase === "ended" && (
          <>
            <Chip>{s.hunters} {s.hunters === 1 ? "person found G$" : "people found G$"}</Chip>
            <Chip>{s.claims} {s.claims === 1 ? "drop claimed" : "drops claimed"}</Chip>
          </>
        )}
      </div>
    </Link>
  );
}

function Chip({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={`inline-flex items-center h-7 px-2.5 rounded-full text-xs/none ${strong ? "bg-brand-soft text-brand" : "border border-line text-heading"}`}>
      {children}
    </span>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="bg-white rounded-3xl p-5 shadow-[0px_0px_12px_0px_#0000000A] animate-pulse" aria-hidden>
      <div className="flex gap-4">
        <div className="w-12 h-12 rounded-2xl bg-surface" />
        <div className="flex-1 flex flex-col gap-3">
          <div className="h-7 w-32 rounded-full bg-surface" />
          <div className="h-5 w-3/4 rounded-full bg-surface" />
          <div className="h-4 w-1/2 rounded-full bg-surface" />
        </div>
      </div>
      <div className="mt-6 h-2 rounded-full bg-surface" />
      <div className="mt-4 flex gap-2"><div className="h-7 w-24 rounded-full bg-surface" /><div className="h-7 w-28 rounded-full bg-surface" /></div>
    </div>
  );
}
