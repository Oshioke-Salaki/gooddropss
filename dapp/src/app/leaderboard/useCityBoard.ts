"use client";
import { useCallback, useEffect, useState } from "react";
import { cityAt, type CityBoardJson } from "@/lib/cities";

export interface CityRank {
  id: string;
  name: string;
  country: string;
  foundWei: bigint;
  claims: number;
  hunters: number;
  hidden: number;
}

export interface CityBoardData {
  rows: CityRank[];
  /** Unix seconds: when this week's board resets. */
  endsAt: number;
}

let shared: { at: number; data: CityBoardData } | null = null;
const TTL_MS = 30_000;

async function load(): Promise<CityBoardData> {
  if (shared && Date.now() - shared.at < TTL_MS) return shared.data;
  const r = await fetch("/api/board/cities");
  if (!r.ok) throw new Error(`city board ${r.status}`);
  const j = (await r.json()) as CityBoardJson;
  const data = { rows: j.rows.map((x) => ({ ...x, foundWei: BigInt(x.foundWei) })), endsAt: j.week.end };
  shared = { at: Date.now(), data };
  return data;
}

/** This week's city-vs-city board (see /api/board/cities). Loads only when `enabled`. */
export function useCityBoard(enabled: boolean) {
  const [data, setData] = useState<CityBoardData | null>(() => shared?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError(false);
    try { setData(await load()); } catch { setError(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (enabled && !data) void fetchBoard(); }, [enabled, data, fetchBoard]);

  return { data, loading: loading || (enabled && !data && !error), error, refresh: fetchBoard };
}

/**
 * The visitor's city, only if they've ALREADY allowed location for this site:
 * this never asks. Null when unknown, refused or outside every listed city.
 */
export function useMyCity(): string | null {
  const [city, setCity] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
        if (p?.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          (pos) => { if (alive) setCity(cityAt(pos.coords.latitude, pos.coords.longitude)?.id ?? null); },
          () => {},
          { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 8_000 },
        );
      } catch { /* no permissions API: stay unknown */ }
    })();
    return () => { alive = false; };
  }, []);
  return city;
}
