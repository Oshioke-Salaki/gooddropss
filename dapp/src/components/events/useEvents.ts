"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventPhase, EventStatsJson, GdEvent } from "@/lib/events";

export interface EventRow {
  event: GdEvent;
  stats: EventStatsJson;
  interested?: number;
}

export interface EventLists {
  live: EventRow[];
  upcoming: EventRow[];
  past: EventRow[];
}

export interface EventDetail {
  event: GdEvent;
  stats: EventStatsJson;
  interested: number;
  viewer: { isHost: boolean; isOrganizer: boolean; interested: boolean };
  phase: EventPhase;
}

/**
 * Fetch JSON on mount and keep it fresh while the tab is visible.
 * Refetches immediately when the tab comes back and after any drop is created
 * in the app (gd:drop-created). A failed refresh keeps the last good data;
 * `error` only shows when there's nothing to show.
 */
function usePolled<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(!!url);
  const alive = useRef(true);
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (res.status === 404) { if (alive.current) { setNotFound(true); setData(null); } return; }
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as T;
      if (alive.current && urlRef.current === u) { setData(json); setError(false); setNotFound(false); }
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!url) { setData(null); setLoading(false); return; }
    setLoading(true);
    load();
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("gd:drop-created", load);
    window.addEventListener("gd:events-changed", load);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("gd:drop-created", load);
      window.removeEventListener("gd:events-changed", load);
    };
  }, [url, intervalMs, load]);

  return { data, error: error && !data, notFound, loading: loading && !data && !notFound, refresh: load };
}

export function useEventLists() {
  return usePolled<EventLists>("/api/events", 30_000);
}

export function useHostEvents(address: string | undefined) {
  return usePolled<{ events: EventRow[] }>(address ? `/api/events?host=${address.toLowerCase()}` : null, 30_000);
}

export function useEventDetail(id: string, viewer: string | undefined) {
  const url = `/api/events/${id}${viewer ? `?viewer=${viewer.toLowerCase()}` : ""}`;
  // A 404 means not found or not visible to this viewer (unapproved), not a blip.
  return usePolled<EventDetail>(url, 20_000);
}

/** Tell every events view on the page to refetch (after create/edit/cancel). */
export function announceEventsChanged() {
  window.dispatchEvent(new CustomEvent("gd:events-changed"));
}

/** Unix seconds, ticking. Countdowns re-render without refetching. */
export function useNowSec(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}
