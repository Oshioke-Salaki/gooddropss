"use client";
import {
  Activity, CalendarDays, GraduationCap, HeartHandshake, Music, PartyPopper, ShoppingBasket, Trophy, Users,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_LABEL, type EventCategory, type EventPhase, type GdEvent } from "@/lib/events";

export const CATEGORY_ICON: Record<EventCategory, LucideIcon> = {
  meetup: Users, concert: Music, campus: GraduationCap, sports: Trophy,
  market: ShoppingBasket, festival: PartyPopper, community: HeartHandshake, other: CalendarDays,
};

export function CategoryChip({ category, className = "" }: { category: EventCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? CalendarDays;
  return (
    <span className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface text-sm/none text-heading ${className}`}>
      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
      {CATEGORY_LABEL[category] ?? "Event"}
    </span>
  );
}

/** Phase for public views. Live is the loud one. */
export function PhasePill({ phase, cancelled, label }: { phase: EventPhase; cancelled?: boolean; label?: string }) {
  if (cancelled) {
    return <span className="inline-flex items-center h-8 px-3 rounded-full bg-danger/10 text-danger text-sm/none">Cancelled</span>;
  }
  if (phase === "live") {
    return (
      <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-brand text-white text-sm/none">
        <Activity aria-hidden className="w-4 h-4" strokeWidth={2} />
        {label ?? "Live now"}
      </span>
    );
  }
  if (phase === "upcoming") {
    return <span className="inline-flex items-center h-8 px-3 rounded-full bg-brand-soft text-brand text-sm/none">{label ?? "Upcoming"}</span>;
  }
  return <span className="inline-flex items-center h-8 px-3 rounded-full bg-surface text-nav-muted text-sm/none">{label ?? "Ended"}</span>;
}

/** Review status, shown to hosts only. */
export function StatusPill({ event }: { event: GdEvent }) {
  const base = "inline-flex items-center h-7 px-2.5 rounded-full text-xs/none whitespace-nowrap";
  if (event.status === "pending") return <span className={`${base} bg-streak-bg text-streak`}>Pending review</span>;
  if (event.status === "rejected") return <span className={`${base} bg-danger/10 text-danger`}>{event.rejectReason?.startsWith("Removed") ? "Taken down" : "Needs changes"}</span>;
  if (event.status === "cancelled") return <span className={`${base} bg-surface text-nav-muted`}>Cancelled</span>;
  if (event.pendingEdit) return <span className={`${base} bg-streak-bg text-streak`}>Edit in review</span>;
  return <span className={`${base} bg-brand-soft text-brand`}>Approved</span>;
}

/** Dropped vs budget, with claimed as an inner fill. */
export function BudgetBar({ budgetG, droppedG, claimedG, className = "" }: { budgetG: number; droppedG: number; claimedG: number; className?: string }) {
  const pct = (n: number) => `${Math.min(100, budgetG > 0 ? (n / budgetG) * 100 : 0)}%`;
  return (
    <div
      className={`relative h-2 rounded-full bg-surface overflow-hidden ${className}`}
      role="img"
      aria-label={`${droppedG.toLocaleString()} of ${budgetG.toLocaleString()} G$ dropped, ${claimedG.toLocaleString()} claimed`}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-brand/25" style={{ width: pct(droppedG) }} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: pct(claimedG) }} />
    </div>
  );
}
