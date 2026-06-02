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

  return { drops, loading, fetchDrops };
}
