"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { AlertCircle, Camera, Check, Gift, Loader2, Lock, QrCode, ShieldCheck } from "lucide-react";
import { scannerSessionMessage } from "@/lib/taskCreateMsg";
import { CODE_RE, NONCE_RE } from "@/lib/taskShared";
import { formatG$ } from "@/lib/utils";
import { buzz } from "@/lib/sound";
import { Sheet } from "@/components/ui/Sheet";

// The shop's counter tool. One wallet confirmation unlocks it on this phone for
// 12 hours (lib/scannerSession); after that, approving a customer is: point the
// camera at their code, tap Approve. The camera opens on its own, stays on
// between customers, and goes back to scanning by itself after each approval.

type Session = "checking" | "locked" | "unlocking" | "unlocked";
type Step = "ready" | "checking" | "confirm" | "approving" | "done" | "error";

interface Peek {
  nonce: string; task: string; amountWei: string; claimable: boolean;
  spotName: string | null; ownerAddress: string | null;
}

// Scans a few times a second, not every frame: plenty for a code held up to the
// camera, and far lighter on a low-end phone's CPU and battery.
const SCAN_EVERY_MS = 250;
// After "Approved", back to scanning on its own after this long.
const NEXT_AFTER_MS = 2500;
// A code that was just dismissed or failed is ignored for this long, so a phone
// still held up to the camera doesn't loop the same screen.
const IGNORE_MS = 6000;

type Detect = (video: HTMLVideoElement) => Promise<string | null>;

/** The platform's barcode detector where it exists, else a lazily loaded JS decoder (iPhone, Firefox, some wallets). */
async function makeDetector(): Promise<Detect> {
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const det = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      return async (v) => ((await det.detect(v))?.[0]?.rawValue as string | undefined)?.trim() ?? null;
    } catch { /* fall through to the JS decoder */ }
  }
  const jsQR = (await import("jsqr")).default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (v) => {
    if (!ctx || !v.videoWidth) return null;
    const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data?.trim() ?? null;
  };
}

/** Plain words for why the camera didn't open. */
function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (!navigator.mediaDevices?.getUserMedia) return "This browser can't use the camera. Type the 6-digit code instead.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is off. Allow it in your browser settings, or type the 6-digit code.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Type the 6-digit code instead.";
  if (name === "NotReadableError") return "Another app is using the camera. Close it, or type the 6-digit code.";
  return "Couldn't open the camera. Type the 6-digit code instead.";
}

export function TaskScanner({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectRef = useRef<Detect | null>(null);
  const pausedRef = useRef(false);
  const mounted = useRef(true);
  const ignore = useRef(new Map<string, number>());   // nonce → ignore until (ms)

  const [session, setSession] = useState<Session>("checking");
  const [sessionErr, setSessionErr] = useState("");
  const [camOn, setCamOn] = useState(false);
  const [camStarting, setCamStarting] = useState(false);
  const [camErr, setCamErr] = useState("");
  const [step, setStep] = useState<Step>("ready");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [approvedPeek, setApprovedPeek] = useState<Peek | null>(null);
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState("");

  const stopCamera = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (nextRef.current) clearTimeout(nextRef.current);
      stopCamera();
    };
  }, [stopCamera]);

  // ── Code lookup → confirm ────────────────────────────────────────────────
  const lookup = useCallback(async (q: { nonce?: string; code?: string }) => {
    pausedRef.current = true;
    if (nextRef.current) { clearTimeout(nextRef.current); nextRef.current = null; }
    setStep("checking"); setMsg(""); setPeek(null);
    try {
      const qs = q.code ? `code=${q.code}` : `nonce=${q.nonce}`;
      const res = await fetch(`/api/task/peek?${qs}`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      const fail = (m: string) => {
        if (q.nonce) ignore.current.set(q.nonce, Date.now() + IGNORE_MS);
        setStep("error"); setMsg(m);
      };
      if (!res.ok) return fail(d.error ?? "Couldn't read that code. Try again.");
      if (address && d.ownerAddress && d.ownerAddress.toLowerCase() !== address.toLowerCase()) {
        return fail("This reward belongs to a different shop.");
      }
      if (!d.claimable) return fail("This reward has already been claimed or has expired.");
      setPeek(d as Peek);
      setStep("confirm");
    } catch {
      if (!mounted.current) return;
      setStep("error"); setMsg("You're offline. Check your connection and try again.");
    }
  }, [address]);

  const scanLoop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const v = videoRef.current;
      if (!streamRef.current || !v || !detectRef.current) return;
      if (!pausedRef.current && !document.hidden) {
        try {
          const raw = (await detectRef.current(v))?.toLowerCase();
          const until = raw ? ignore.current.get(raw) ?? 0 : 0;
          if (raw && NONCE_RE.test(raw) && Date.now() >= until && !pausedRef.current) {
            buzz(40);
            await lookup({ nonce: raw });
          }
        } catch { /* a missed frame; keep going */ }
      }
      scanLoop();
    }, SCAN_EVERY_MS);
  }, [lookup]);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return;
    setCamErr(""); setCamStarting(true);
    try {
      detectRef.current ??= await makeDetector();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      // Closed while the permission prompt was up: release the camera at once.
      if (!mounted.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      // Scanning stays paused while a customer's code is on screen; only moving
      // on (next(), or the auto-return after "Approved") resumes it.
      setCamOn(true);
      scanLoop();
    } catch (e) {
      if (mounted.current) setCamErr(cameraError(e));
      stopCamera();
    } finally {
      if (mounted.current) setCamStarting(false);
    }
  }, [scanLoop, stopCamera]);

  // ── Session: is this phone unlocked for the signed-in wallet? ──────────────
  useEffect(() => {
    let alive = true;
    setSession("checking");
    fetch("/api/task/scanner", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { address: null }))
      .catch(() => ({ address: null }))
      .then((d: { address?: string | null }) => {
        if (!alive) return;
        const ok = !!address && typeof d.address === "string" && d.address === address.toLowerCase();
        setSession(ok ? "unlocked" : "locked");
      });
    return () => { alive = false; };
  }, [address]);

  // Unlocked → the camera opens by itself. Locked → it stays off.
  useEffect(() => {
    if (session === "unlocked") void startCamera();
    if (session === "locked") stopCamera();
  }, [session, startCamera, stopCamera]);

  // ── Approve ────────────────────────────────────────────────────────────────
  const approve = useCallback(async (p: Peek) => {
    if (!address) { setStep("error"); setMsg("Sign in with your shop's wallet first."); return; }
    setStep("approving"); setMsg("");
    try {
      const res = await fetch("/api/task/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce: p.nonce, merchantWallet: address }),
      });
      const d = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (res.ok && d.ok) {
        ignore.current.set(p.nonce, Number.POSITIVE_INFINITY);
        setApprovedPeek(p); setPeek(null); setManual("");
        setStep("done");
        buzz([30, 40, 30]);
        // Back to scanning by itself; "Scan the next customer" skips the wait.
        nextRef.current = setTimeout(() => {
          if (!mounted.current) return;
          setStep((s) => (s === "done" ? "ready" : s));
          setApprovedPeek(null);
          pausedRef.current = false;
        }, NEXT_AFTER_MS);
        return;
      }
      if (res.status === 401 && d.code === "scanner_locked") {
        // The 12 hours ran out (or another wallet signed in): unlock, and this
        // customer is approved straight after.
        setStep("confirm");
        setSession("locked");
        return;
      }
      setStep("error");
      setMsg(d.error ?? "Couldn't approve. Try again.");
    } catch {
      if (!mounted.current) return;
      setStep("confirm");
      setMsg("You're offline. Check your connection and tap Approve again.");
    }
  }, [address]);

  const unlock = useCallback(async () => {
    if (!address) { setSessionErr("Sign in with your shop's wallet first."); return; }
    setSession("unlocking"); setSessionErr("");
    try {
      const timestamp = Date.now();
      let signature: string;
      try {
        signature = await signMessageAsync({ message: scannerSessionMessage(address, timestamp) });
      } catch {
        if (mounted.current) { setSession("locked"); setSessionErr("You didn't confirm in your wallet. Tap to try again."); }
        return;
      }
      const res = await fetch("/api/task/scanner", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, timestamp }),
      });
      const d = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok) { setSession("locked"); setSessionErr(d.error ?? "Couldn't unlock the scanner. Try again."); return; }
      setSession("unlocked");
      // A customer was waiting when it locked: approve them now.
      if (peek && step === "confirm") void approve(peek);
    } catch {
      if (mounted.current) { setSession("locked"); setSessionErr("You're offline. Check your connection and try again."); }
    }
  }, [address, signMessageAsync, peek, step, approve]);

  const lock = useCallback(async () => {
    stopCamera();
    setSession("locked"); setStep("ready"); setPeek(null); setMsg("");
    pausedRef.current = false;
    await fetch("/api/task/scanner", { method: "DELETE" }).catch(() => {});
  }, [stopCamera]);

  /** Back to scanning for the next customer (camera stays on). */
  function next() {
    if (nextRef.current) { clearTimeout(nextRef.current); nextRef.current = null; }
    if (peek) ignore.current.set(peek.nonce, Date.now() + IGNORE_MS);
    setStep("ready"); setPeek(null); setApprovedPeek(null); setMsg(""); setManual("");
    pausedRef.current = false;
  }

  const close = () => { stopCamera(); onClose(); };
  const manualDigits = manual.replace(/\D/g, "");
  const busy = step === "checking" || step === "approving";
  const unlocked = session === "unlocked";
  const shown = peek ?? approvedPeek;

  return (
    <Sheet title="Approve a reward" onClose={close} dismissible={step !== "approving" && session !== "unlocking"} width={440}>
      <div className="flex flex-col gap-y-5 pt-6">
        {/* ── Camera / status panel ─────────────────────────────────────── */}
        <div className="relative rounded-3xl overflow-hidden bg-surface aspect-square">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ display: camOn ? "block" : "none" }} />

          {session === "checking" && (
            <Centered><Loader2 className="w-7 h-7 animate-spin text-nav-muted" aria-label="Loading" /></Centered>
          )}

          {(session === "locked" || session === "unlocking") && !peek && (
            <Centered>
              <span className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-heading">
                <ShieldCheck className="w-6 h-6" strokeWidth={1.75} />
              </span>
              <p className="text-xl/none text-heading">Unlock your scanner</p>
              <p className="text-sm/[140%] text-nav-muted max-w-[300px]">
                Confirm once and you can approve customers on this phone for the next 12 hours. Nothing leaves your wallet.
              </p>
            </Centered>
          )}

          {unlocked && !camOn && step === "ready" && (
            <Centered>
              <span className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-heading">
                {camStarting ? <Loader2 className="w-6 h-6 animate-spin" /> : <QrCode className="w-6 h-6" strokeWidth={1.75} />}
              </span>
              <p className="text-sm/[140%] text-nav-muted max-w-[280px]">
                {camStarting ? "Opening the camera…" : camErr || "Scan the customer's code, or type the 6 digits under it."}
              </p>
            </Centered>
          )}

          {unlocked && camOn && step === "ready" && (
            <>
              <div aria-hidden className="absolute inset-8 rounded-2xl border-2 border-white/90 pointer-events-none" />
              <p className="absolute bottom-4 inset-x-0 text-center text-sm/none text-white drop-shadow">Point at the customer&apos;s code</p>
            </>
          )}

          {/* Result over the camera, so the shop never loses its place */}
          {step !== "ready" && (unlocked || peek) && (
            <div className={`absolute inset-0 ${camOn ? "bg-white/95" : "bg-surface"} flex flex-col items-center justify-center text-center gap-4 px-6`} role="status" aria-live="polite">
              {step === "checking" && (<><Loader2 className="w-8 h-8 animate-spin text-heading" /><p className="text-base/none text-heading">Checking the code…</p></>)}
              {(step === "confirm" || step === "approving" || step === "done") && shown && (
                <>
                  <span className={`w-14 h-14 rounded-full flex items-center justify-center ${step === "done" ? "success-pop bg-brand text-white" : "bg-brand-soft text-brand"}`}>
                    {step === "done" ? <Check className="w-7 h-7" strokeWidth={2.25} /> : <Gift className="w-6 h-6" strokeWidth={1.75} />}
                  </span>
                  <p className="text-sm/none text-nav-muted">{step === "done" ? "Approved" : shown.spotName ?? "Your shop"}</p>
                  <p className="text-xl/[130%] text-heading break-words">{shown.task}</p>
                  <p className="text-[32px]/none text-brand tabular-nums">{formatG$(BigInt(shown.amountWei))} <span className="text-base/none">G$</span></p>
                  <p className="text-sm/[140%] text-nav-muted">
                    {step === "done" ? "Their G$ is on its way. Scanning again in a moment." : "Did they do this? Approving sends them the G$."}
                  </p>
                </>
              )}
              {step === "error" && (
                <>
                  <span className="w-14 h-14 rounded-full bg-[#FFF0F0] text-danger flex items-center justify-center"><AlertCircle className="w-6 h-6" strokeWidth={1.75} /></span>
                  <p className="text-base/[140%] text-heading">{msg}</p>
                </>
              )}
            </div>
          )}
        </div>

        {(msg && step === "confirm") && <p role="alert" className="-mt-2 text-sm/[140%] text-danger text-center">{msg}</p>}
        {sessionErr && session === "locked" && <p role="alert" className="-mt-2 text-sm/[140%] text-danger text-center">{sessionErr}</p>}
        {!address && session === "locked" && !sessionErr && (
          <p className="-mt-2 text-sm/[140%] text-nav-muted text-center">Sign in with your shop&apos;s wallet to unlock it.</p>
        )}

        {/* ── Actions ────────────────────────────────────────────────────── */}
        {session === "checking" ? null
        : !unlocked ? (
          <button type="button" onClick={unlock} disabled={session === "unlocking" || !address} className={PRIMARY}>
            {session === "unlocking" ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" strokeWidth={1.75} />}
            {session === "unlocking" ? "Confirm in your wallet…" : peek ? "Unlock and approve" : "Unlock and scan"}
          </button>
        ) : step === "confirm" || step === "approving" ? (
          <div className="flex gap-2">
            <button type="button" onClick={next} disabled={step === "approving"} className={`${SECONDARY} flex-1`}>
              Not yet
            </button>
            <button type="button" onClick={() => peek && approve(peek)} disabled={step === "approving"} className={`${PRIMARY} flex-[2]`}>
              {step === "approving" && <Loader2 className="w-5 h-5 animate-spin" />}
              {step === "approving" ? "Approving…" : "Approve"}
            </button>
          </div>
        ) : step === "done" || step === "error" ? (
          <button type="button" onClick={next} className={PRIMARY}>
            {camOn ? "Scan the next customer" : "Done"}
          </button>
        ) : !camOn ? (
          <button type="button" onClick={() => void startCamera()} disabled={camStarting} className={PRIMARY}>
            {camStarting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" strokeWidth={1.75} />}
            {camStarting ? "Opening camera…" : camErr ? "Try the camera again" : "Scan a code"}
          </button>
        ) : null}

        {/* Typed fallback: works on every phone, with or without a camera */}
        {unlocked && (step === "ready" || step === "error") && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manualDigits.length === 6) void lookup({ code: manualDigits }); }}>
            <label className="flex-1 min-w-0">
              <span className="sr-only">6-digit code</span>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
                placeholder="Or type the 6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={busy}
                className="w-full h-12 rounded-full bg-surface px-5 text-base/none text-heading tracking-[0.15em]
                  placeholder:text-nav-muted placeholder:tracking-normal border border-transparent outline-none
                  motion-safe:transition-colors focus:border-brand disabled:opacity-60"
              />
            </label>
            <button type="submit" disabled={busy || !CODE_RE.test(manualDigits)}
              className="shrink-0 h-12 px-5 rounded-full bg-nav-active text-white text-sm/none cursor-pointer hover:opacity-90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed">
              Check
            </button>
          </form>
        )}

        {unlocked && step === "ready" && (
          <button type="button" onClick={lock}
            className="self-center inline-flex items-center gap-1.5 h-10 px-3 rounded-full text-sm/none text-nav-muted cursor-pointer hover:text-heading motion-safe:transition-colors">
            <Lock className="w-4 h-4" strokeWidth={1.75} /> Lock scanner on this phone
          </button>
        )}
      </div>
    </Sheet>
  );
}

const PRIMARY =
  "w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer " +
  "motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed";
const SECONDARY =
  "h-14 rounded-full border border-line bg-white text-base/none text-heading cursor-pointer hover:bg-surface disabled:opacity-60";

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">{children}</div>;
}
