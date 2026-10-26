"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fromDropJson, type DropJson } from "@/lib/dropJson";
import type { Drop } from "@/types";

/**
 * Every drop one wallet created or claimed (My Drops, claim notifications).
 *
 * Mirrors useDrops' surface (drops / loading / fetchDrops) so My Drops swaps
 * over unchanged. `address` undefined = signed out: no request, empty list.
 * After the first load, fetches skip the instance cache — they follow an action
 * (reclaim, reactivate) whose result the person is waiting to see.
 */
export function useMyDrops(address: string | undefined) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const fetchDrops = useCallback(async (opts?: { fresh?: boolean }) => {
    if (!address) { setDrops([]); return; }
    const a = address.toLowerCase();
    const fresh = opts?.fresh ?? loadedFor.current === a;
    setLoading(true);
    try {
      const res = await fetch(`/api/drops/mine?address=${a}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`my drops ${res.status}`);
      const body = (await res.json()) as { drops: DropJson[] };
      setDrops(body.drops.map(fromDropJson));
      setError(false);
      loadedFor.current = a;
    } catch (e) {
      console.error("[useMyDrops]", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Switching wallets must never show the previous wallet's drops.
  useEffect(() => {
    if (loadedFor.current && loadedFor.current !== address?.toLowerCase()) setDrops([]);
  }, [address]);

  return { drops, loading, error, fetchDrops };
}
