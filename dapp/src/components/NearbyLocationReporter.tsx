"use client";
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { haversineDistance } from "@/lib/utils";
import type { LatLng } from "@/types";

// Headless. When a hunter has notifications ON and their location is available,
// it shares a COARSE location (server rounds to ~110 m) so we can ping them about
// drops that appear nearby. Throttled hard — only when they've moved meaningfully
// or enough time has passed — so it's light on battery and network. Sharing stops
// automatically when they turn notifications off (the subscribe DELETE clears it).
const MIN_MOVE_M      = 80;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export function NearbyLocationReporter({ userLoc }: { userLoc: LatLng | null }) {
  const { address } = useAccount();
  const { status }  = usePushSubscription();
  const last = useRef<{ lat: number; lng: number; t: number } | null>(null);

  useEffect(() => {
    if (status !== "subscribed" || !address || !userLoc) return;
    const now  = Date.now();
    const prev = last.current;
    const moved = prev ? haversineDistance(prev.lat, prev.lng, userLoc.lat, userLoc.lng) : Infinity;
    if (prev && moved < MIN_MOVE_M && now - prev.t < MIN_INTERVAL_MS) return;
    last.current = { lat: userLoc.lat, lng: userLoc.lng, t: now };
    fetch("/api/push/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, lat: userLoc.lat, lng: userLoc.lng }),
    }).catch(() => {});
  }, [address, status, userLoc]);

  return null;
}
