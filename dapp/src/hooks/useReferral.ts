"use client";
import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { SITE_URL } from "@/lib/site";
import {
  REF_STORAGE_KEY, REF_DONE_KEY,
  referralAcceptMessage, inviteUrl,
} from "@/lib/referral";

// Referral state for the connected wallet: their invite link + how many people
// they've brought in, plus a one-tap "accept your invite" flow for newcomers.
export function useReferral() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { isVerified } = useIdentityStatus();

  const [count, setCount]           = useState(0);
  const [referredBy, setReferredBy] = useState<string | null>(null);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [accepting, setAccepting]   = useState(false);

  // 1) Read any pending referrer captured globally by <ReferralCapture />.
  useEffect(() => {
    try { setPendingRef(localStorage.getItem(REF_STORAGE_KEY)); } catch { /* ignore */ }
  }, []);

  // 2) My referral stats.
  const refresh = useCallback(async () => {
    if (!address) { setCount(0); setReferredBy(null); return; }
    try {
      const r = await fetch(`/api/referral?address=${address}`);
      const d = await r.json();
      setCount(d.count ?? 0);
      setReferredBy(d.referredBy ?? null);
    } catch { /* keep last */ }
  }, [address]);
  useEffect(() => { refresh(); }, [refresh]);

  // Show the "accept invite" prompt only when it can actually succeed: a verified
  // newcomer, with a pending referrer that isn't themselves, not already credited.
  const done = (() => { try { return !!localStorage.getItem(REF_DONE_KEY); } catch { return false; } })();
  const canAccept =
    !!address && isVerified && !!pendingRef && !referredBy && !done &&
    pendingRef.toLowerCase() !== address.toLowerCase();

  const acceptReferral = useCallback(async (): Promise<boolean> => {
    if (!address || !pendingRef || accepting) return false;
    setAccepting(true);
    try {
      const timestamp = Date.now();
      const signature = await signMessageAsync({ message: referralAcceptMessage(pendingRef, timestamp) });
      const res = await fetch("/api/referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrer: pendingRef, signature, timestamp }),
      });
      if (!res.ok) return false;
      try { localStorage.setItem(REF_DONE_KEY, "1"); localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
      setPendingRef(null);
      await refresh();
      return true;
    } catch { return false; }
    finally { setAccepting(false); }
  }, [address, pendingRef, accepting, signMessageAsync, refresh]);

  const inviteLink = address ? inviteUrl(SITE_URL, address) : "";

  return { count, referredBy, inviteLink, canAccept, accepting, acceptReferral, refresh };
}
