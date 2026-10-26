"use client";
import { useState, useEffect, useMemo, useReducer } from "react";
import { useAccount } from "wagmi";

export interface Profile {
  username?: string;
  createdAt?: number;
  /** chosen preset avatar id (see lib/avatarPresets). Absent = generated avatar. */
  avatar?: string;
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

/**
 * Resolve many addresses in ONE request, sharing the cache `useProfile` uses.
 *
 * Each pending address is registered in the same `inflight` map, so the
 * `useProfile` calls inside every row and avatar await this batch instead of
 * firing their own request — a leaderboard of 200 wallets costs one round-trip,
 * not 200.
 *
 * The claim happens during RENDER, not in an effect. React runs child effects
 * before the parent's, so an effect here would land after every row had already
 * started its own fetch — exactly the storm this exists to prevent. `useMemo` is
 * safe for it: registering is idempotent (guarded by the cache/inflight maps),
 * so a discarded or double-invoked render costs nothing.
 *
 * Returns a snapshot keyed by lowercased address (`undefined` = still loading).
 */
export function useProfiles(addresses: string[]): Record<string, Profile | null | undefined> {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);

  // Sorted join: a stable identity for the set, so a re-render that produces an
  // equal-but-new array doesn't re-trigger the fetch.
  const key = useMemo(
    () => [...new Set(addresses.map((a) => a.toLowerCase()))].sort().join(","),
    [addresses],
  );

  const pending = useMemo(() => {
    if (!key || typeof window === "undefined") return null;
    const missing = key.split(",").filter((a) => !cache.has(a) && !inflight.has(a));
    if (missing.length === 0) return null;

    const batch = fetch("/api/profile/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addresses: missing }),
    })
      .then((r) => (r.ok ? r.json() : { profiles: {} }))
      .then((d) => (d?.profiles ?? {}) as Record<string, Profile | null>)
      .catch(() => ({}) as Record<string, Profile | null>);

    for (const addr of missing) {
      inflight.set(
        addr,
        batch.then((profs) => {
          const v = profs[addr] ?? null;
          cache.set(addr, v);
          inflight.delete(addr);
          return v;
        }),
      );
    }
    return batch;
  }, [key]);

  useEffect(() => {
    if (!pending) return;
    let active = true;
    pending.then(() => { if (active) bump(); });
    return () => { active = false; };
  }, [pending]);

  return useMemo(() => {
    const out: Record<string, Profile | null | undefined> = {};
    if (!key) return out;
    for (const a of key.split(",")) out[a] = cache.get(a);
    return out;
    // `tick` is the dep that matters: the cache isn't reactive, so the batch
    // landing has to force this snapshot to recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
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
