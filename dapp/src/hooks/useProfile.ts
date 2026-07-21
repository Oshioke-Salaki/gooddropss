"use client";
import { useState, useEffect } from "react";
import { useAccount } from "wagmi";

export interface Profile {
  username: string;
  createdAt: number;
}

// Module-level cache — survives re-renders, cleared on page reload
const cache       = new Map<string, Profile | null>();
const inflight    = new Map<string, Promise<Profile | null>>();

const PROFILE_UPDATED = "gd:profileUpdated";

async function fetchProfile(address: string): Promise<Profile | null> {
  try {
    const res = await fetch(`/api/profile?address=${address.toLowerCase()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function getOrFetch(address: string): Promise<Profile | null> {
  const key = address.toLowerCase();
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (inflight.has(key)) return inflight.get(key)!;
  const p = fetchProfile(key).then((v) => {
    cache.set(key, v);
    inflight.delete(key);
    return v;
  });
  inflight.set(key, p);
  return p;
}

// Invalidate a single address after a profile update
export function invalidateProfile(address: string) {
  cache.delete(address.toLowerCase());
}

// Call after a username is set/changed. Clears the cache AND notifies every
// mounted useProfile() so handles, the wallet pill and win cards refresh
// immediately — no page reload needed.
export function refreshProfile(address: string) {
  invalidateProfile(address);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PROFILE_UPDATED, { detail: { address: address.toLowerCase() } }),
    );
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useProfile(address: string | undefined) {
  const [profile, setProfile] = useState<Profile | null | undefined>(
    address ? cache.get(address.toLowerCase()) : undefined
  );

  useEffect(() => {
    if (!address) { setProfile(undefined); return; }
    let active = true;
    const key = address.toLowerCase();

    getOrFetch(address).then((v) => { if (active) setProfile(v); });

    // Re-fetch when this address's profile is updated anywhere in the app.
    const onUpdated = (e: Event) => {
      const target = (e as CustomEvent<{ address?: string }>).detail?.address;
      if (target && target !== key) return;
      getOrFetch(address).then((v) => { if (active) setProfile(v); });
    };
    window.addEventListener(PROFILE_UPDATED, onUpdated);
    return () => { active = false; window.removeEventListener(PROFILE_UPDATED, onUpdated); };
  }, [address]);

  return profile;
}

/**
 * The connected wallet's profile plus a `needsName` signal for username nudges.
 *
 * `needsName` is true ONLY once we've confirmed on the server that there's no
 * username yet — never while loading (`profile === undefined`) — so a nudge never
 * flashes for someone who already has a name.
 */
export function useMyProfile() {
  const { address } = useAccount();
  const profile = useProfile(address);
  return {
    address,
    username: profile?.username ?? null,
    loaded:   !!address && profile !== undefined,
    needsName: !!address && profile !== undefined && !profile?.username,
  };
}
