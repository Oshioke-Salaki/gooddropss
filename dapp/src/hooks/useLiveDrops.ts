"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fromDropJson, type DropJson } from "@/lib/dropJson";
import type { Drop } from "@/types";

const REFRESH_MS = 60_000;

/**
 * Drops that can be claimed right now, for the map.
 *
 * Same surface as the old useDrops (drops / loading / fetchDrops / markClaimed)
 * so the map page swaps over without behaviour changes, but it asks the server
 * for live drops only — tens of rows instead of the whole drop history.
 *
 * Stays fresh on its own: refetches every minute while the tab is visible and
 * immediately when the person comes back to it, so a drop hidden while they were
 * away shows up without a reload. After the first load every fetch skips the
 * caches, because it's a refresh after something happened.
 */
export function useLiveDrops() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadedOnce = useRef(false);

  const fetchDrops = useCallback(async (opts?: { fresh?: boolean }) => {
    const fresh = opts?.fresh ?? loadedOnce.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/drops/live${fresh ? "?fresh=1" : ""}`, fresh ? { cache: "no-store" } : undefined);
      if (!res.ok) throw new Error(`live drops ${res.status}`);
      const body = (await res.json()) as { drops: DropJson[] };
      setDrops(body.drops.map(fromDropJson));
      setError(false);
      loadedOnce.current = true;
    } catch (e) {
      // Keep whatever is on the map; a blip shouldn't blank it.
      console.error("[useLiveDrops]", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // A claimed drop leaves the map at once; the refetch confirms against the chain.
  const markClaimed = useCallback((dropId: bigint) => {
    setDrops((prev) => prev.filter((d) => d.id !== dropId));
    setTimeout(() => { fetchDrops({ fresh: true }); }, 5000);
  }, [fetchDrops]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible" && loadedOnce.current) fetchDrops(); };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    // A drop created anywhere in the app should appear without waiting a minute.
    const onCreated = () => fetchDrops({ fresh: true });
    window.addEventListener("gd:drop-created", onCreated);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("gd:drop-created", onCreated);
    };
  }, [fetchDrops]);

  return { drops, loading, error, fetchDrops, markClaimed };
}
