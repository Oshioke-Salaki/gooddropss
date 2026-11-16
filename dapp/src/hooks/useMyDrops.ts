"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fromDropJson, type DropJson } from "@/lib/dropJson";
import type { Drop } from "@/types";
import { readLinkedRoot } from "@/lib/walletLink";

/**
 * Every drop one wallet created or claimed (My Drops, claim notifications).
 *
 * Mirrors useDrops' surface (drops / loading / fetchDrops) so My Drops swaps
 * over unchanged. `address` undefined = signed out: no request, empty list.
 * After the first load, fetches skip the instance cache — they follow an action
 * (reclaim, reactivate) whose result the person is waiting to see.
 *
 * A wallet LINKED to an original one (someone who moved from MetaMask to email
 * sign-in on /switch-to-email) also gets the original wallet's drops and finds,
 * so their history never looks lost. `linkedFrom` names that wallet; those drops
 * can only be changed from it, which the page makes clear.
 */
export function useMyDrops(address: string | undefined) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [linkedFrom, setLinkedFrom] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const fetchDrops = useCallback(async (opts?: { fresh?: boolean }) => {
    if (!address) { setDrops([]); return; }
    const a = address.toLowerCase();
    const fresh = opts?.fresh ?? loadedFor.current === a;
    setLoading(true);
    try {
      const load = async (who: string) => {
        const res = await fetch(`/api/drops/mine?address=${who}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`my drops ${res.status}`);
        return ((await res.json()) as { drops: DropJson[] }).drops.map(fromDropJson);
      };
      // The link lookup is one cheap read; a failure just means "no extra history".
      const linkedP = readLinkedRoot(a).catch(() => null);
      const [own, linked] = await Promise.all([load(a), linkedP]);
      const other = linked && linked !== a ? linked : null;
      // The original wallet's history is a bonus: if it fails, still show the rest.
      const extra = other ? await load(other).catch(() => [] as Drop[]) : [];
      const byId = new Map<string, Drop>();
      for (const d of [...own, ...extra]) byId.set(d.id.toString(), d);
      setDrops([...byId.values()].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)));
      setLinkedFrom(other);
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
    if (loadedFor.current && loadedFor.current !== address?.toLowerCase()) { setDrops([]); setLinkedFrom(null); }
  }, [address]);

  return { drops, loading, error, fetchDrops, linkedFrom };
}
