"use client";
import { useEffect, useState } from "react";
import type { DropRarity } from "@/lib/utils";

export interface HunterFind { lat: number; lng: number; amount: string; color: string }
export interface RecentClaim { id: string; amount: string; claimedAt: number; rarity: DropRarity }

export interface HunterProfileData {
  address: string;
  claims: number;
  created: number;
  totalClaimedWei: string;
  totalDroppedWei: string;
  biggestWei: string;
  avgWei: string;
  firstHunt: number;
  referralCount: number;
  /** Up to three referred wallets, for the invite banner's faces. */
  referredSample: string[];
  rarityCounts: Record<DropRarity, number>;
  finds: HunterFind[];
  recentClaims: RecentClaim[];
}

export interface WallBadge {
  id: string; name: string; emoji: string; description: string;
  builtin: boolean; earned: boolean; earnedAt: number | null;
  holders: number; minted: boolean;
}

/**
 * Everything the drawer renders, for one address.
 *
 * Two requests, both fired in parallel and both independently stateful — the
 * stats block shouldn't wait on the badge wall, or vice versa, so each renders
 * its own skeleton until its own data lands.
 *
 * `address` null (drawer closed) clears state, so reopening on someone else
 * never flashes the previous person's numbers.
 */
export function useHunterProfile(address: string | null, isOwn: boolean) {
  const [data, setData] = useState<HunterProfileData | null>(null);
  const [badges, setBadges] = useState<WallBadge[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!address) { setData(null); setBadges(null); setError(false); return; }
    let cancelled = false;
    setData(null); setBadges(null); setError(false);

    fetch(`/api/hunter?address=${address.toLowerCase()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d: HunterProfileData) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });

    // Your own wall skips the CDN cache so a just-earned badge shows immediately;
    // hitting this endpoint also lazily awards anything newly eligible.
    const url = `/api/badges?address=${address.toLowerCase()}${isOwn ? "&fresh=1" : ""}`;
    fetch(url, isOwn ? { cache: "no-store" } : undefined)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setBadges(Array.isArray(d.badges) ? d.badges : []); })
      .catch(() => { if (!cancelled) setBadges([]); });

    return () => { cancelled = true; };
  }, [address, isOwn]);

  return { data, badges, error };
}
