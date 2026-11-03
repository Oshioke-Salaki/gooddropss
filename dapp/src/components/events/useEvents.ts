"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventPhase, EventStatsJson, GdEvent } from "@/lib/events";
import { announceSessionChanged } from "@/hooks/useWalletSession";

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
  viewer: { isHost: boolean; isOrganizer: boolean; interested: boolean; verified?: boolean; trusted?: boolean };
  phase: EventPhase;
}

/**
 * Fetch JSON on mount and keep it fresh while the tab is visible.
 * Refetches immediately when the tab comes back and after any drop is created
 * in the app (gd:drop-created). A failed refresh keeps the last good data;
 * `error` only shows when there's nothing to show, and `stale` says the data
 * on screen is from the last good fetch (`lastOk`), so views never claim to be
 * live while frozen.
 *
 * One request at a time: a burst of triggers (a cancel fires session + events
 * changes, and the page refreshes too) collapses into at most one follow-up.
 */
function usePolled<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // 404 for a host whose browser hasn't confirmed the wallet yet (unapproved event).
  const [needsVerify, setNeedsVerify] = useState(false);
  const [loading, setLoading] = useState(!!url);
  const [refreshing, setRefreshing] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const alive = useRef(true);
  const urlRef = useRef(url);
  urlRef.current = url;
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const fetchOnce = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        if (alive.current && urlRef.current === u) { setNotFound(true); setNeedsVerify(!!body?.needsVerify); setData(null); }
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as T;
      if (alive.current && urlRef.current === u) {
        setData(json); setError(false); setNotFound(false); setNeedsVerify(false); setLastOk(Date.now());
      }
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  const load = useCallback((): Promise<void> => {
    if (inFlight.current) { again.current = true; return inFlight.current; }
    const run = (async () => {
      do { again.current = false; await fetchOnce(); } while (again.current && alive.current);
    })();
    inFlight.current = run.finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, [fetchOnce]);

  /** For "Try again" buttons: shows progress while it runs. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { if (alive.current) setRefreshing(false); }
  }, [load]);

  useEffect(() => {
    alive.current = true;
    if (!url) { setData(null); setLoading(false); return; }
    setLoading(true);
    load();
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("gd:drop-created", tick);
    window.addEventListener("gd:events-changed", tick);
    window.addEventListener("gd:session-changed", tick);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("gd:drop-created", tick);
      window.removeEventListener("gd:events-changed", tick);
      window.removeEventListener("gd:session-changed", tick);
    };
  }, [url, intervalMs, load]);

  return {
    data, error: error && !data, stale: error && !!data, lastOk, notFound, needsVerify,
    loading: loading && !data && !notFound, refreshing, refresh,
  };
}

export function useEventLists() {
  return usePolled<EventLists>("/api/events", 30_000);
}

export function useHostEvents(address: string | undefined) {
  return usePolled<{ events: EventRow[]; verified?: boolean; hidden?: number }>(address ? `/api/events?host=${address.toLowerCase()}` : null, 30_000);
}

export function useEventDetail(id: string, viewer: string | undefined, intervalMs = 20_000) {
  const url = `/api/events/${id}${viewer ? `?viewer=${viewer.toLowerCase()}` : ""}`;
  // A 404 means not found or not visible to this viewer (unapproved), not a blip.
  return usePolled<EventDetail>(url, intervalMs);
}

/** Tell every events view on the page to refetch (after create/edit/cancel). */
export function announceEventsChanged() {
  // A signed create/edit/cancel also starts a wallet session server-side, so
  // session-aware views (the verify prompts) re-check too.
  announceSessionChanged();
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
