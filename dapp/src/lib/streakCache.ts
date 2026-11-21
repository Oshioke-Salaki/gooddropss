"use client";
import type { HunterStreak } from "@/types";

// One streak lookup per wallet, shared by the nav badge, the wallet and profile
// pages, kept for a minute. A claim fires "gd:streak-updated", which clears it so
// the next read is fresh (and the milestone toast still sees the new number).

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<HunterStreak | null>; value?: HunterStreak | null }>();

if (typeof window !== "undefined") {
  window.addEventListener("gd:streak-updated", () => cache.clear());
}

export function getStreak(address: string, opts: { fresh?: boolean } = {}): Promise<HunterStreak | null> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const entry: { at: number; p: Promise<HunterStreak | null>; value?: HunterStreak | null } = { at: Date.now(), p: Promise.resolve(null) };
  entry.p = fetch(`/api/engagement?address=${key}`)
    .then((r) => r.json())
    .then((d) => { const v = (d?.streak ?? null) as HunterStreak | null; entry.value = v; return v; })
    .catch((e) => { if (cache.get(key) === entry) cache.delete(key); throw e; });
  cache.set(key, entry);
  return entry.p;
}

/** The last answer already in hand, for a first paint without a spinner. */
export function peekStreak(address: string | undefined): HunterStreak | null | undefined {
  if (!address) return undefined;
  const hit = cache.get(address.toLowerCase());
  return hit && "value" in hit ? hit.value : undefined;
}
