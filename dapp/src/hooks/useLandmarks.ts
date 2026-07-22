"use client";
import { useState, useEffect, useCallback } from "react";
import type { Landmark } from "@/types";

/**
 * Fetches map landmarks. `scope: "all"` returns hidden ones too (admin views).
 * Refetches when a `gd:landmarks-updated` event fires (after create/edit/delete),
 * so the map and management list stay live without a reload.
 */
export function useLandmarks(scope?: "all") {
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/landmarks${scope === "all" ? "?scope=all" : ""}`);
      const data = await res.json();
      if (Array.isArray(data?.landmarks)) setLandmarks(data.landmarks);
    } catch {
      /* keep whatever we had — landmarks are cosmetic */
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener("gd:landmarks-updated", onUpdate);
    return () => window.removeEventListener("gd:landmarks-updated", onUpdate);
  }, [refresh]);

  return { landmarks, loading, refresh };
}
