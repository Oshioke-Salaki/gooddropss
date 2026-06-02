"use client";
import { useState, useEffect } from "react";

export interface Profile {
  username: string;
  createdAt: number;
}

// Module-level cache — survives re-renders, cleared on page reload
const cache       = new Map<string, Profile | null>();
const inflight    = new Map<string, Promise<Profile | null>>();

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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useProfile(address: string | undefined) {
  const [profile, setProfile] = useState<Profile | null | undefined>(
    address ? cache.get(address.toLowerCase()) : undefined
  );

  useEffect(() => {
    if (!address) return;
    getOrFetch(address).then(setProfile);
  }, [address]);

  return profile;
}
