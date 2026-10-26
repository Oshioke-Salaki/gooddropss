"use client";
import Link from "next/link";
import { ChevronRight, Pencil, XCircle } from "lucide-react";
import { eventPhase, type GdEvent } from "@/lib/events";
import { StatusPill } from "./Pieces";
import { formatWhen } from "./format";
import type { EventRow } from "./useEvents";

/**
 * The signed-in person's own events, every status, newest first. The review
 * outcome is the first thing they need, so the status pill leads and a
 * reviewer's note is shown in full.
 */
export function HostEvents({ rows, now, onEdit, onCancel }: {
  rows: EventRow[];
  now: number;
  onEdit: (e: GdEvent) => void;
  onCancel: (e: GdEvent) => void;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map(({ event: e }) => {
        const ended = e.status === "approved" && eventPhase(e, now) === "ended";
        const editable = e.status !== "cancelled" && !ended;
        return (
          <li key={e.id} className="bg-white rounded-3xl p-4 shadow-[0px_0px_12px_0px_#0000000A] flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <Link href={`/events/${e.id}`} className="min-w-0 flex-1 group">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusPill event={e} />
                  <span className="text-xs/none text-nav-muted">{formatWhen(e.startsAt)}</span>
                </div>
                <p className="mt-2 text-base/[1.3] text-heading truncate group-hover:text-brand">{e.title}</p>
              </Link>
              <Link href={`/events/${e.id}`} aria-label={`Open ${e.title}`}
                className="w-10 h-10 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading hover:bg-nav-controls">
                <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
            {e.status === "rejected" && e.rejectReason && (
              <p className="rounded-2xl bg-danger/10 px-3.5 py-2.5 text-sm/[145%] text-danger">{e.rejectReason}</p>
            )}
            {e.status === "approved" && e.rejectReason?.startsWith("Edit not approved") && (
              <p className="rounded-2xl bg-streak-bg px-3.5 py-2.5 text-sm/[145%] text-heading">{e.rejectReason}</p>
            )}
            {editable && (
              <div className="flex gap-2">
                <button type="button" onClick={() => onEdit(e)}
                  className="h-10 px-4 rounded-full border border-line text-sm/none text-heading flex items-center gap-1.5 cursor-pointer hover:bg-surface">
                  <Pencil className="w-3.5 h-3.5" /> {e.status === "rejected" ? "Fix & resubmit" : "Edit"}
                </button>
                <button type="button" onClick={() => onCancel(e)}
                  className="h-10 px-4 rounded-full border border-line text-sm/none text-danger flex items-center gap-1.5 cursor-pointer hover:bg-danger/5">
                  <XCircle className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
