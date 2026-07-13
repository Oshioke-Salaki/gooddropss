"use client";
import { useState, useEffect } from "react";

export interface RiddleInfo {
  question:      string;
  lockedByOther: boolean;
  lockedByMe:    boolean;
}

// Fetches a riddle-locked drop's QUESTION. The answer only ever exists on the
// server — this endpoint never returns it.
//
// `hasRiddle` comes from the on-chain [R] marker, so callers know a riddle is
// required before this resolves. Shared by every claim surface (the map's
// ClaimSheet and the /drop/[id] share-link page) so they can't drift apart —
// a claim path that forgets the riddle just 403s with no way to answer.
export function useRiddle(dropId: string | null, hasRiddle: boolean, claimer?: string) {
  const [riddle, setRiddle]   = useState<RiddleInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dropId || !hasRiddle) { setRiddle(null); return; }
    let cancelled = false;
    setLoading(true);
    const qs = claimer ? `?claimer=${claimer}` : "";
    fetch(`/api/riddles/${dropId}${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRiddle(d.riddle ?? null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dropId, hasRiddle, claimer]);

  return { riddle, loading };
}
