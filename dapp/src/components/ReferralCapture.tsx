"use client";
import { useEffect } from "react";
import { REF_PARAM, captureRef } from "@/lib/referral";

export const REF_CAPTURED_EVENT = "gd:ref-captured";

// Headless, mounted app-wide (Providers). Captures ?ref=<addr> from ANY landing
// (a drop link, a hunter card, the homepage) onto the device; the first invite
// opened wins and it expires after 30 days. Accepting it happens once they're
// signed in (see ReferralAutoCredit).
//
// The ?ref stays in the address bar on purpose. Invite links are mostly opened
// inside WhatsApp, X or Instagram, whose in-app browsers don't share storage
// with the phone's real browser. Someone who taps "Open in browser" carries the
// URL across, and the invite with it; stripping it here used to lose them.
export function ReferralCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get(REF_PARAM);
      if (!ref) return;
      captureRef(ref);
      window.dispatchEvent(new Event(REF_CAPTURED_EVENT));
    } catch { /* ignore */ }
  }, []);
  return null;
}
