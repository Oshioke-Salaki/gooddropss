"use client";
import { useEffect } from "react";
import { REF_PARAM, REF_STORAGE_KEY, REF_ADDR_RE } from "@/lib/referral";

// Headless, mounted app-wide (Providers). Captures ?ref=<addr> from ANY landing
// — a drop link, a hunter card, the homepage — into localStorage, then strips it
// from the URL. Attribution itself happens later, once the newcomer verifies
// (see useReferral). Runs once per page load; storing is idempotent.
export function ReferralCapture() {
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const ref = p.get(REF_PARAM);
      if (!ref) return;
      if (REF_ADDR_RE.test(ref)) localStorage.setItem(REF_STORAGE_KEY, ref.toLowerCase());
      p.delete(REF_PARAM);
      const qs = p.toString();
      window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    } catch { /* ignore */ }
  }, []);
  return null;
}
