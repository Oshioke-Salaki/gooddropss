"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

// "Is this browser in the middle of restoring a signed-in session?"
//
// wagmi remembers the last connection in localStorage ("wagmi.store") and, on a
// fresh page load, reconnects it (Magic can take a few seconds). Until that
// finishes, the app must not look signed out: no "Sign in" button for someone
// who is about to be signed in. A visitor with no saved session never waits.
//
// Settles when: connected; or a reconnect ran and ended without a connection
// (session expired); or wagmi never started one (nothing to restore); or a
// safety cap, so a stalled connector can't trap anyone on a loader.

const NEVER_STARTED_MS = 1200;
/** The full-screen loader steps aside after this, so the app is always usable. */
const CAP_MS = 8000;
/** The nav keeps its placeholder while a reconnect is still running, up to this. */
const HARD_CAP_MS = 20_000;

/** True once this visit has finished its restore; later mounts don't wait again. */
let settledThisVisit = false;

// Our own marker: set while someone is signed in, cleared when they sign out or a
// restore fails. wagmi's saved state alone can't tell "signed out" from "about to
// reconnect" (it keeps the last connector either way).
const HINT_KEY = "gd:signed-in";
export function markSignedIn(on: boolean) {
  try { if (on) localStorage.setItem(HINT_KEY, "1"); else localStorage.removeItem(HINT_KEY); } catch { /* private mode */ }
}

export function hadSavedSession(): boolean {
  try {
    if (localStorage.getItem(HINT_KEY) === "1") return true;
    // Fallback for sessions from before the marker existed.
    const s = JSON.parse(localStorage.getItem("wagmi.store") || "null")?.state;
    const conns = s?.connections?.value;
    return !!s?.current && Array.isArray(conns) && conns.length > 0;
  } catch {
    return false;
  }
}

export function useSessionRestore(): {
  /** A saved session is being restored: show the loader. */
  restoring: boolean;
  /** Still unsure whether they're signed in (restoring, or a reconnect still running): don't say "Sign in". */
  unsure: boolean;
} {
  const { status } = useAccount();
  // Server and first client render agree (restoring), so hydration stays clean.
  const [phase, setPhase] = useState<"init" | "waiting" | "done">(() => (settledThisVisit ? "done" : "init"));
  const sawAttempt = useRef(false);
  const startedAt = useRef(0);

  // Decide once on mount whether there's anything to wait for.
  useEffect(() => {
    if (phase !== "init") return;
    startedAt.current = Date.now();
    setPhase(hadSavedSession() ? "waiting" : "done");
  }, [phase]);

  useEffect(() => {
    if (phase !== "waiting") return;
    if (status === "connecting" || status === "reconnecting") sawAttempt.current = true;
    if (status === "connected" || (sawAttempt.current && status === "disconnected")) { setPhase("done"); return; }
    const elapsed = Date.now() - startedAt.current;
    const t = window.setTimeout(() => setPhase("done"),
      sawAttempt.current ? Math.max(0, CAP_MS - elapsed) : Math.max(0, NEVER_STARTED_MS - elapsed));
    return () => window.clearTimeout(t);
  }, [phase, status]);

  useEffect(() => { if (phase === "done") settledThisVisit = true; }, [phase]);

  // After the loader's cap a slow reconnect may still be running. Until it ends
  // (or the hard cap), the nav stays neutral instead of showing "Sign in".
  const [hardCapped, setHardCapped] = useState(false);
  const busy = status === "connecting" || status === "reconnecting";
  useEffect(() => {
    if (!busy || hardCapped) return;
    const left = HARD_CAP_MS - (Date.now() - (startedAt.current || Date.now()));
    const t = window.setTimeout(() => setHardCapped(true), Math.max(0, left));
    return () => window.clearTimeout(t);
  }, [busy, hardCapped]);

  // Keep the marker true to reality: on when connected, off once a restore has
  // ended without a connection (expired session), so the next load doesn't wait.
  useEffect(() => {
    if (status === "connected") markSignedIn(true);
    else if (phase === "done" && status === "disconnected") markSignedIn(false);
  }, [status, phase]);

  const restoring = phase !== "done";
  return { restoring, unsure: restoring || (busy && sawAttempt.current && !hardCapped) };
}
