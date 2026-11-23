"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useReferral, settleInvite } from "@/hooks/useReferral";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { REF_CAPTURED_EVENT } from "@/components/ReferralCapture";
import { ConfirmInviteSheet } from "@/components/referral/InviteSheets";
import {
  readCapturedRef, clearCapturedRef, confirmsSilently, isFinalInvite, type CapturedRef,
} from "@/lib/referral";

/**
 * Headless (plus one sheet). Turns an invite link into a counted referral:
 *
 *  1. ACCEPT  Once the newcomer is signed in, their wallet confirms "I accept
 *             <referrer>'s invite". Magic wallets do it silently; other wallets
 *             get a one-tap card first. The server saves it, so from here on the
 *             invite lives on the server, not this device.
 *  2. SETTLE  The server counts it as soon as they're verified and have claimed
 *             or hidden a drop. This component nudges it right after those
 *             moments, retrying for a couple of minutes while the drop index
 *             catches up; the server's sweep covers anyone who's left the app.
 */

/** After something that could qualify them: re-check now, then back off. */
const SETTLE_DELAYS_MS = [0, 4_000, 10_000, 25_000, 60_000, 120_000];
/** A declined confirm card stays quiet this long for that invite. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const snoozeKey = (address: string, ref: string) => `gd_ref_snooze:${address.toLowerCase()}:${ref}`;

function snoozed(address: string, ref: string): boolean {
  try { return Date.now() - Number(localStorage.getItem(snoozeKey(address, ref)) ?? 0) < SNOOZE_MS; }
  catch { return false; }
}
function snooze(address: string, ref: string) {
  try { localStorage.setItem(snoozeKey(address, ref), String(Date.now())); } catch { /* private mode */ }
}

export function ReferralAutoCredit() {
  const { address, connector, status: walletStatus } = useAccount();
  const { status, accept, refresh } = useReferral();
  const { isVerified } = useIdentityStatus();

  const [captured, setCaptured] = useState<CapturedRef | null>(null);
  const [asking, setAsking] = useState<string | null>(null); // referrer shown in the card
  const tried = useRef(new Set<string>());                     // `${address}:${ref}` accepted this session

  // The invite this device carries (and any captured later this session).
  useEffect(() => {
    const read = () => setCaptured(readCapturedRef());
    read();
    window.addEventListener(REF_CAPTURED_EVENT, read);
    return () => window.removeEventListener(REF_CAPTURED_EVENT, read);
  }, []);

  // New wallet, new state.
  useEffect(() => { setAsking(null); }, [address]);

  const inviteState = status?.invite.status;

  // ── 1. Accept ────────────────────────────────────────────────────────────
  useEffect(() => {
    // Only once fully connected: mid-reconnect the connector can be unknown, and a
    // Magic wallet would be mistaken for one that needs the confirm card.
    if (!address || walletStatus !== "connected" || !connector || !status || !captured) return;
    const me = address.toLowerCase();

    // Nothing left to do for this device's invite: drop it.
    if (captured.ref === me || inviteState === "already" || inviteState === "waiting") {
      // ("waiting": the server already holds an invite for them; first one wins.)
      clearCapturedRef(); setCaptured(null);
      return;
    }
    if (inviteState !== "none") return;
    // Long-time players can't be invited; don't ask them to confirm one.
    if (status.canBeInvited === false) { clearCapturedRef(); setCaptured(null); return; }

    const key = `${me}:${captured.ref}`;
    if (tried.current.has(key)) return;

    if (confirmsSilently(connector.id)) {
      tried.current.add(key);
      accept(captured.ref)
        .then((r) => { if (isFinalInvite(r.status) || r.status === "waiting") { clearCapturedRef(); setCaptured(null); } })
        // Declined or offline: leave it on the device and try again next visit.
        .catch(() => {});
    } else if (!snoozed(me, captured.ref)) {
      tried.current.add(key);
      // A beat after sign-in, so it doesn't land on top of the sign-in itself.
      const t = setTimeout(() => setAsking(captured.ref), 1200);
      return () => clearTimeout(t);
    }
  }, [address, walletStatus, connector, status, inviteState, captured, accept]);

  const closeAsk = (final: boolean) => {
    if (address && asking) {
      if (final) { clearCapturedRef(); setCaptured(null); }
      else snooze(address, asking);
    }
    setAsking(null);
  };

  // ── 2. Settle ────────────────────────────────────────────────────────────
  const burst = useRef<{ id: number; timer?: ReturnType<typeof setTimeout> }>({ id: 0 });

  const settleBurst = useCallback(() => {
    if (!address) return;
    const id = ++burst.current.id;
    if (burst.current.timer) clearTimeout(burst.current.timer);
    const run = (i: number) => {
      if (id !== burst.current.id || i >= SETTLE_DELAYS_MS.length) return;
      burst.current.timer = setTimeout(async () => {
        if (id !== burst.current.id) return;
        try {
          const r = await settleInvite(address);
          if (r.status !== "waiting") { refresh(); return; } // counted, final, or nothing saved
          // Not verified yet: no amount of retrying helps until they are.
          if (r.reason === "verify") return;
        } catch { /* offline: keep going */ }
        run(i + 1);
      }, SETTLE_DELAYS_MS[i]);
    };
    run(0);
  }, [address, refresh]);

  useEffect(() => () => { burst.current.id++; if (burst.current.timer) clearTimeout(burst.current.timer); }, [address]);

  useEffect(() => {
    if (inviteState !== "waiting") return;
    settleBurst(); // on load, and again once they verify (isVerified flips)
    const onAction = () => settleBurst();
    const onVisible = () => { if (document.visibilityState === "visible") settleBurst(); };
    window.addEventListener("gd:streak-updated", onAction);
    window.addEventListener("gd:claim-success", onAction);
    window.addEventListener("gd:drop-created", onAction);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("gd:streak-updated", onAction);
      window.removeEventListener("gd:claim-success", onAction);
      window.removeEventListener("gd:drop-created", onAction);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [inviteState, isVerified, settleBurst]);

  if (!address || !asking) return null;
  return <ConfirmInviteSheet referrer={asking} accept={accept} onClose={closeAsk} />;
}
