"use client";
import { useEffect, useState } from "react";
import type { HunterStreak } from "@/types";

/**
 * Hunting streak for one address.
 *
 * `undefined` while loading, `null` once we know there isn't one — the caller
 * needs to tell those apart so a chip never flashes in and then out.
 */
export function useHunterStreak(address: string | null): HunterStreak | null | undefined {
  const [streak, setStreak] = useState<HunterStreak | null | undefined>(undefined);

  useEffect(() => {
    if (!address) { setStreak(undefined); return; }
    let cancelled = false;
    setStreak(undefined);
    fetch(`/api/engagement?address=${address.toLowerCase()}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setStreak(d?.streak ?? null); })
      .catch(() => { if (!cancelled) setStreak(null); });
    return () => { cancelled = true; };
  }, [address]);

  return streak;
}
