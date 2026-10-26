"use client";
import { useEffect, useState } from "react";
import type { GdEvent } from "@/lib/events";

export type EventSummary = Pick<GdEvent, "id" | "title" | "startsAt" | "endsAt" | "status" | "venueName">;

// Shared across every drop sheet on the page: one request per event, ever.
const cache = new Map<string, Promise<EventSummary | null>>();

function load(id: string): Promise<EventSummary | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/events/${id}`)
      .then((r) => {
        if (r.status === 404) return null; // genuinely not an event (or not public): remember that
        if (!r.ok) throw new Error(String(r.status)); // transient: don't cache, the next sheet retries
        return r.json() as Promise<{ event?: GdEvent }>;
      })
      .then((d) =>
        d?.event ? { id, title: d.event.title, startsAt: d.event.startsAt, endsAt: d.event.endsAt, status: d.event.status, venueName: d.event.venueName } : null)
      .catch(() => { cache.delete(id); return null; });
    cache.set(id, p);
  }
  return p;
}

/**
 * The event a drop belongs to, fetched lazily. `undefined` while loading,
 * `null` if it couldn't be read (callers fall back to a plain "Event drop").
 */
export function useEventSummary(id: string | null | undefined): EventSummary | null | undefined {
  const [ev, setEv] = useState<EventSummary | null | undefined>(id ? undefined : null);
  useEffect(() => {
    if (!id) { setEv(null); return; }
    let alive = true;
    setEv(undefined);
    load(id).then((e) => { if (alive) setEv(e); });
    return () => { alive = false; };
  }, [id]);
  return ev;
}

/** "Tue 28 Oct, 6:00 PM" in the viewer's own time. */
export function eventStartLabel(s: number): string {
  return new Date(s * 1000).toLocaleString("en", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
