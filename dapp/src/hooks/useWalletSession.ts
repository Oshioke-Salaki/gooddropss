"use client";
import { useCallback, useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import { walletSessionMessage } from "@/lib/walletSessionMsg";

// Which wallet this browser has a session for (lib/walletSession). One shared
// fetch for every component on the page; refreshed on "gd:session-changed",
// which fires after sign-in, sign-out, and any signed action that starts a
// session server-side (registering a shop, creating an event).

let cache: string | null | undefined;           // undefined = not loaded yet
let inflight: Promise<string | null> | null = null;

function load(force = false): Promise<string | null> {
  if (!force && cache !== undefined) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { address: null }))
      .then((d: { address?: unknown }) => (cache = typeof d.address === "string" ? d.address : null))
      .catch(() => (cache = null))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Tell every session-aware view to re-check (the server just set or cleared the cookie). */
export function announceSessionChanged() {
  cache = undefined;
  window.dispatchEvent(new Event("gd:session-changed"));
}

export function useWalletSession(address: string | undefined) {
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<string | null | undefined>(cache);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const sync = (force: boolean) => load(force).then((a) => { if (alive) setSession(a); });
    sync(false);
    const onChange = () => sync(true);
    window.addEventListener("gd:session-changed", onChange);
    return () => { alive = false; window.removeEventListener("gd:session-changed", onChange); };
  }, []);

  const verified = !!address && session === address.toLowerCase();

  /** One signature → a 30-day session for this wallet on this browser. */
  const verify = useCallback(async (): Promise<boolean> => {
    if (!address || verifying) return false;
    setVerifying(true);
    setError("");
    try {
      const timestamp = Date.now();
      let signature: string;
      try {
        signature = await signMessageAsync({ message: walletSessionMessage(address, timestamp) });
      } catch {
        setError("Signing was cancelled.");
        return false;
      }
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, timestamp }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "Couldn't confirm your wallet. Try again."); return false; }
      announceSessionChanged();
      return true;
    } catch {
      setError("Network error. Try again.");
      return false;
    } finally {
      setVerifying(false);
    }
  }, [address, verifying, signMessageAsync]);

  return { verified, checking: session === undefined, verify, verifying, error };
}
