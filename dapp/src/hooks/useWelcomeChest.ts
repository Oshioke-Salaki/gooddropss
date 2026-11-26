"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useSignMessage } from "wagmi";
import { welcomeMessage, type WelcomeView } from "@/lib/welcome";
import type { LatLng } from "@/types";

/** GET/POST /api/welcome (see lib/welcome). */
export const welcomeKey = (address?: string) => ["welcome", address?.toLowerCase()] as const;

async function get(address: string): Promise<WelcomeView> {
  const r = await fetch(`/api/welcome?address=${address.toLowerCase()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`welcome ${r.status}`);
  return r.json();
}

/** A fresh, precise fix: the chest goes where they really are, not where they were. */
function freshFix(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((ok) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 10_000 },
    );
  });
}

/** This wallet's welcome chest, and the action that hides it. */
export function useWelcomeChest(address?: string) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState("");

  const query = useQuery({
    queryKey: welcomeKey(address),
    queryFn: () => get(address!),
    enabled: !!address,
    // The answer only changes when they act, so one read per few minutes is plenty.
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const hide = useCallback(async (fallback: LatLng | null): Promise<WelcomeView | null> => {
    if (!address || hiding) return null;
    setHiding(true);
    setError("");
    try {
      const fix = (await freshFix()) ?? (fallback ? { ...fallback, accuracy: undefined } : null);
      if (!fix) { setError("Turn on your location so we can hide it near you."); return null; }
      const timestamp = Date.now();
      let signature: string;
      try {
        signature = await signMessageAsync({ message: welcomeMessage(address, timestamp) });
      } catch {
        setError(""); // they closed the wallet prompt: nothing to report
        return null;
      }
      const r = await fetch("/api/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.toLowerCase(), signature, timestamp, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.error ?? "Couldn't hide your chest. Please try again."); return null; }
      qc.setQueryData(welcomeKey(address), body as WelcomeView);
      return body as WelcomeView;
    } catch {
      setError("Couldn't reach GoodDrops. Check your connection and try again.");
      return null;
    } finally {
      setHiding(false);
    }
  }, [address, hiding, qc, signMessageAsync]);

  /** After opening it: show the opened state without waiting for the next read. */
  const markOpened = useCallback(() => {
    if (!address) return;
    const v = qc.getQueryData<WelcomeView>(welcomeKey(address));
    if (v?.state !== "live") return;
    const opened: WelcomeView = { state: "claimed", amountG: v.amountG, dropId: v.dropId };
    qc.setQueryData(welcomeKey(address), opened);
  }, [address, qc]);

  return { view: query.data ?? null, loading: query.isLoading, hide, hiding, error, clearError: () => setError(""), markOpened, refetch: query.refetch };
}
