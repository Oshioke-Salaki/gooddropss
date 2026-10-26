"use client";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Gift, Loader2 } from "lucide-react";
import { QR_TTL_S } from "@/lib/taskShared";
import type { Drop, LatLng } from "@/types";

// Shown inside ClaimSheet for a merchant TASK drop. The hunter does the task,
// taps "I did it" to mint a one-time QR, shows it to the merchant, and once the
// merchant approves (polled) the parent unlocks the normal claim.
type Step = "intro" | "minting" | "showing" | "approved" | "error";

// Re-mint a few seconds before the server-side nonce actually expires, so the
// merchant never scans a code that's already dead.
const REFRESH_AT_S = Math.max(15, QR_TTL_S - 10);

export function TaskUnlock({
  drop, userLocation, address, onApproved,
}: { drop: Drop; userLocation: LatLng | null; address: string; onApproved: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [task, setTask] = useState<string | null>(null);
  const [nonce, setNonce] = useState("");
  const [secsLeft, setSecsLeft] = useState(0);
  const [err, setErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remintRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always call the freshest iDidIt from the expiry timer (fresh props/closure).
  const remintFn = useRef<() => void>(() => {});

  function clearTimers() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    if (remintRef.current) clearTimeout(remintRef.current);
  }

  // Fetch the task text up front so the hunter knows what to do.
  useEffect(() => {
    let alive = true;
    fetch(`/api/task/info?dropId=${drop.id.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (alive && d?.task) setTask(d.task); })
      .catch(() => {});
    return () => { alive = false; clearTimers(); };
  }, [drop.id]);

  async function iDidIt() {
    if (!userLocation) { setErr("Turn on location so the merchant knows you're here."); setStep("error"); return; }
    setStep("minting"); setErr("");
    try {
      const res = await fetch("/api/task/qr", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId: drop.id.toString(), address, lat: userLocation.lat, lng: userLocation.lng }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't create your code — try again."); setStep("error"); return; }
      setNonce(d.nonce); if (d.task) setTask(d.task); setStep("showing");
      startPolling();
      armExpiry();
    } catch { setErr("Network error — try again."); setStep("error"); }
  }
  remintFn.current = iDidIt;

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/task/status?dropId=${drop.id.toString()}&address=${address}`);
        const d = await r.json();
        if (d.approved) {
          clearTimers();
          setStep("approved");
          setTimeout(onApproved, 900);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  // Countdown + silent auto re-mint, so a slow merchant scan never dead-ends the
  // hunter: the QR quietly rotates to a fresh, valid code before it expires.
  function armExpiry() {
    if (tickRef.current) clearInterval(tickRef.current);
    if (remintRef.current) clearTimeout(remintRef.current);
    setSecsLeft(REFRESH_AT_S);
    tickRef.current = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1000);
    remintRef.current = setTimeout(() => { remintFn.current(); }, REFRESH_AT_S * 1000);
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4 font-sans">
      <div className="flex items-center gap-3">
        <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
          <Gift className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex flex-col gap-y-1">
          <p className="text-base/none text-heading">Merchant reward</p>
          <p className="text-sm/[140%] text-nav-muted">
            {task ? <>Do this to unlock: <span className="text-heading">{task}</span></> : "Complete the merchant's task to unlock this reward."}
          </p>
        </div>
      </div>

      {step === "intro" && (
        <button
          type="button"
          onClick={iDidIt}
          className="mt-4 w-full h-12 rounded-full bg-brand text-white text-base/none cursor-pointer
            motion-safe:transition-colors hover:bg-brand/90"
        >
          I did it, show my code
        </button>
      )}

      {step === "minting" && (
        <p role="status" aria-live="polite" className="mt-4 flex items-center gap-2 text-sm/none text-nav-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Creating your code…
        </p>
      )}

      {step === "showing" && (
        <div className="mt-4 flex flex-col items-center text-center">
          <div className="inline-block rounded-2xl border border-line bg-white p-3">
            <QRCodeSVG value={nonce} size={172} level="M" />
          </div>
          <p className="mt-4 text-base/none text-heading">Show this to the merchant to approve</p>
          <p role="status" aria-live="polite" className="mt-2 flex items-center gap-2 text-sm/none text-nav-muted">
            <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" aria-hidden />
            Waiting for approval{secsLeft > 0 ? ` · refreshes in ${secsLeft}s` : " · refreshing…"}
          </p>
          <p className="mt-2 text-xs/none text-nav-muted/60 font-mono">{nonce.slice(0, 8)}…</p>
        </div>
      )}

      {step === "approved" && (
        <div className="mt-4 flex flex-col items-center text-center gap-y-3 py-2">
          <span className="success-pop w-12 h-12 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Check className="w-6 h-6" strokeWidth={2} />
          </span>
          <p className="text-base/none text-heading">Approved, claiming your reward…</p>
        </div>
      )}

      {step === "error" && (
        <>
          <p role="alert" className="mt-4 text-sm/[140%] text-danger">{err}</p>
          <button
            type="button"
            onClick={iDidIt}
            className="mt-3 w-full h-12 rounded-full border border-line bg-white text-base/none text-heading
              cursor-pointer motion-safe:transition-colors hover:bg-surface"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
