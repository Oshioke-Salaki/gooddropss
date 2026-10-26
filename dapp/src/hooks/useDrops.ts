"use client";
import { useState, useCallback, useRef } from "react";
import { fetchAllDrops } from "@/lib/subgraph";
import type { Drop } from "@/types";

export function useDrops() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedOnce = useRef(false);

  // The first fetch on a mount may come from the short client cache (moving
  // between map, rankings and profile shouldn't re-scan the subgraph). Any
  // later call on the same hook is a refresh after something happened — a
  // claim, a cancel, a withdraw — and must see the chain, so it goes fresh.
  const fetchDrops = useCallback(async (opts: { fresh?: boolean } = {}) => {
    const fresh = opts.fresh ?? fetchedOnce.current;
    fetchedOnce.current = true;
    setLoading(true);
    try {
      const all = await fetchAllDrops({ fresh });
      setDrops(all);
    } catch (e) {
      console.error("[useDrops] subgraph fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const markClaimed = useCallback((dropId: bigint) => {
    const now = Math.floor(Date.now() / 1000);
    setDrops((prev) =>
      prev.map((d) =>
        d.id === dropId ? { ...d, status: 1, claimedAt: now } : d
      )
    );
    // Confirming a claim must bypass the short client cache.
    setTimeout(() => {
      fetchDrops({ fresh: true });
    }, 5000);
  }, [fetchDrops]);

  return { drops, loading, fetchDrops, markClaimed };
}
