"use client";
import { useState, useCallback } from "react";
import { fetchAllDrops } from "@/lib/subgraph";
import type { Drop } from "@/types";

export function useDrops() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDrops = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchAllDrops();
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
    setTimeout(() => {
      fetchDrops();
    }, 5000);
  }, [fetchDrops]);

  return { drops, loading, fetchDrops, markClaimed };
}
