"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Gift, Loader2, MapPin } from "lucide-react";
import { QR_REUSE_MIN_S, formatCode } from "@/lib/taskShared";
import { rememberTask, useTaskInfo } from "@/hooks/useTaskInfo";
import { buzz } from "@/lib/sound";
import type { LatLng } from "@/types";

// The customer's side of a shop reward: their one-time code, shown the moment
// they're at the shop (no "I did it" tap). The shop scans it or types the six
// digits; once approved, `onApproved` fires and the parent claims the G$ on
// its own.
//
// Reliability rules:
//  • The server hands back the SAME code while it's fresh, so reopening this
//    screen never swaps the code under a cashier mid-scan.
//  • It's quietly replaced shortly before it expires (no countdown to watch).
//  • One 3 s heartbeat drives everything (approval check, refresh, retries) and
//    pauses while the phone is locked or the tab is hidden; coming back catches
//    up at once.
//  • An approval that happened while this screen was closed is picked up on open.

type Step = "loading" | "showing" | "approved" | "error";
export type RewardUnavailable = "gone" | "held";

const TICK_MS = 3000;

export function TaskUnlock({
  dropId, userLocation, address, onApproved, onShowing, onUnavailable, amountLabel,
}: {
  dropId: string;
  userLocation: LatLng | null;
  address: string;
  onApproved: () => void;
  /** True while a code is on screen, so the parent keeps this mounted even if GPS wobbles indoors. */
  onShowing?: (showing: boolean) => void;
  /** The reward was taken or is held for someone else. Without it, the message shows here. */
  onUnavailable?: (reason: RewardUnavailable) => void;
  /** e.g. "500 G$", shown beside the title. */
  amountLabel?: string;
}) {
  const known = useTaskInfo(dropId);
  const [task, setTask] = useState<string | null>(known);
  useEffect(() => { if (known) setTask(known); }, [known]);

  const [step, setStep] = useState<Step>("loading");
  const [nonce, setNonce] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [noLocation, setNoLocation] = useState(false);

  // Mutable state the heartbeat reads (no re-subscribing on every render).
  const alive = useRef(true);
  const busy = useRef(false);
  const stepRef = useRef<Step>("loading");
  const refreshAt = useRef(0);     // ms: ask for a new code at/after this
  const retryAt = useRef(0);       // ms: retry a refused/failed request at/after this
  const loc = useRef(userLocation);
  loc.current = userLocation;
  const cbs = useRef({ onApproved, onShowing, onUnavailable });
  cbs.current = { onApproved, onShowing, onUnavailable };

  const go = useCallback((s: Step) => {
    stepRef.current = s;
    setStep(s);
    cbs.current.onShowing?.(s === "showing");
  }, []);

  const approved = useCallback(() => {
    if (stepRef.current === "approved") return;
    go("approved");
    buzz(30);
    // A beat to see "Approved" before the parent takes over with the claim.
    setTimeout(() => { if (alive.current) cbs.current.onApproved(); }, 900);
  }, [go]);

  const issue = useCallback(async () => {
    if (busy.current || stepRef.current === "approved") return;
    const here = loc.current;
    if (!here) { setNoLocation(true); if (stepRef.current !== "showing") go("loading"); return; }
    setNoLocation(false);
    busy.current = true;
    try {
      const res = await fetch("/api/task/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId, address, lat: here.lat, lng: here.lng }),
      });
      const d = await res.json().catch(() => ({}));
      if (!alive.current) return;

      if (res.ok && d.approved) { approved(); return; }
      if (res.ok && typeof d.nonce === "string") {
        setNonce(d.nonce);
        setCode(typeof d.code === "string" ? d.code : null);
        if (typeof d.task === "string" && d.task) { setTask(d.task); rememberTask(dropId, d.task); }
        const left = Number(d.expiresInS) || 0;
        // Ask again once the server would mint a new one (under QR_REUSE_MIN_S left).
        refreshAt.current = Date.now() + Math.max(5, left - QR_REUSE_MIN_S + 5) * 1000;
        retryAt.current = 0;
        setErr("");
        go("showing");
        return;
      }
      if (res.status === 429 && Number(d.retryAfterS) > 0) {
        // Asked for a new code too soon (e.g. just looked at another reward):
        // wait it out quietly. A code already on screen stays valid meanwhile.
        retryAt.current = Date.now() + Number(d.retryAfterS) * 1000 + 300;
        return;
      }
      if (res.status === 409 && (d.reason === "gone" || d.reason === "held")) {
        // Stop here either way; the parent may move on to another reward.
        setErr(typeof d.error === "string" ? d.error : "This reward isn't available right now.");
        go("error");
        cbs.current.onUnavailable?.(d.reason);
        return;
      }
      // While a code is showing, a failed refresh isn't the customer's problem:
      // the current code is still valid for a while. Try again shortly.
      if (stepRef.current === "showing" && res.status >= 500) { retryAt.current = Date.now() + 5000; return; }
      setErr(typeof d.error === "string" && d.error ? d.error : "Couldn't get your code. Try again.");
      go("error");
    } catch {
      if (!alive.current) return;
      if (stepRef.current === "showing") { retryAt.current = Date.now() + 5000; return; }
      setErr("You're offline. Check your connection and try again.");
      go("error");
    } finally {
      busy.current = false;
    }
  }, [dropId, address, approved, go]);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/task/status?dropId=${dropId}&address=${address}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (alive.current && d?.approved) approved();
    } catch { /* next beat */ }
  }, [dropId, address, approved]);

  const tick = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const s = stepRef.current;
    if (s === "approved" || s === "error") return;
    const now = Date.now();
    if (retryAt.current && now < retryAt.current) { if (s === "showing") void poll(); return; }
    if (s === "loading" || (s === "showing" && now >= refreshAt.current) || retryAt.current) {
      retryAt.current = 0;
      void issue();
      return;
    }
    void poll();
  }, [issue, poll]);

  // Start, heartbeat, and catch up when the phone comes back to the screen.
  useEffect(() => {
    alive.current = true;
    go("loading");
    void issue();
    const id = window.setInterval(tick, TICK_MS);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      cbs.current.onShowing?.(false);
    };
  }, [issue, tick, go]);

  // Location arrived after we asked: get the code now instead of on the next beat.
  const hasLocation = !!userLocation;
  useEffect(() => { if (hasLocation && noLocation) void issue(); }, [hasLocation, noLocation, issue]);

  const retry = () => { setErr(""); go("loading"); retryAt.current = 0; void issue(); };

  return (
    <div className="rounded-3xl border border-line bg-white p-5 font-sans">
      <div className="flex items-center gap-3">
        <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center">
          <Gift className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 flex flex-col gap-y-1.5">
          <p className="flex items-baseline justify-between gap-3 text-sm/none text-nav-muted">
            <span>Shop reward</span>
            {amountLabel && <span className="shrink-0 text-heading tabular-nums">{amountLabel}</span>}
          </p>
          {task
            ? <p className="text-base/[130%] text-heading break-words">{task}</p>
            : <span aria-hidden className="block h-4 w-40 rounded-full bg-surface animate-pulse" />}
        </div>
      </div>

      {step === "loading" && (
        <div className="mt-5 flex flex-col items-center text-center" role="status" aria-live="polite">
          <div className="w-[198px] h-[198px] rounded-2xl bg-surface flex items-center justify-center">
            {noLocation
              ? <MapPin className="w-6 h-6 text-nav-muted" strokeWidth={1.75} aria-hidden />
              : <Loader2 className="w-6 h-6 text-nav-muted animate-spin" aria-hidden />}
          </div>
          <p className="mt-4 text-sm/[140%] text-nav-muted">
            {noLocation ? "Turn on location so the shop knows you're here." : "Getting your code…"}
          </p>
        </div>
      )}

      {step === "showing" && (
        <div className="mt-5 flex flex-col items-center text-center">
          <div className="rounded-2xl border border-line bg-white p-3">
            <QRCodeSVG value={nonce} size={172} level="M" aria-label="Your reward code" />
          </div>
          {code && (
            <p
              className="mt-4 text-[32px]/none tracking-[0.12em] text-heading tabular-nums"
              aria-label={`Code ${code.split("").join(" ")}`}
            >
              {formatCode(code)}
            </p>
          )}
          <p className="mt-4 text-base/[140%] text-heading">Do the task, then show this to the shop.</p>
          <p role="status" aria-live="polite" className="mt-2 flex items-center gap-2 text-sm/none text-nav-muted">
            <span aria-hidden className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-brand opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-brand" />
            </span>
            Waiting for the shop to approve
          </p>
        </div>
      )}

      {step === "approved" && (
        <div className="mt-5 flex flex-col items-center text-center gap-y-3 py-4" role="status" aria-live="polite">
          <span className="success-pop w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Check className="w-7 h-7" strokeWidth={2} />
          </span>
          <p className="text-lg/none text-heading">Approved</p>
          <p className="text-sm/none text-nav-muted">Sending your G$…</p>
        </div>
      )}

      {step === "error" && (
        <div className="mt-5 flex flex-col gap-y-3">
          <p role="alert" className="rounded-2xl bg-[#FFF1F1] px-4 py-3 text-sm/[140%] text-danger">{err}</p>
          <button
            type="button"
            onClick={retry}
            className="w-full h-12 rounded-full border border-line bg-white text-base/none text-heading
              cursor-pointer motion-safe:transition-colors hover:bg-surface"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
