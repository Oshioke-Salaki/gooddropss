"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { AlertCircle, Camera, CameraOff, Check, Gift, Loader2, QrCode } from "lucide-react";
import { approveMessage } from "@/lib/taskCreateMsg";
import { CODE_RE, NONCE_RE } from "@/lib/taskShared";
import { formatG$ } from "@/lib/utils";
import { Sheet } from "@/components/ui/Sheet";

type Step = "ready" | "checking" | "confirm" | "approving" | "done" | "error";

interface Peek {
  nonce: string; task: string; amountWei: string; claimable: boolean;
  spotName: string | null; ownerAddress: string | null;
}

// Scans a few times a second, not every frame: plenty for a code held up to the
// camera, and far lighter on a low-end phone's CPU and battery.
const SCAN_EVERY_MS = 250;

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

/**
 * Merchant approves a customer's reward: scan their code (or type the six
 * digits), see exactly which reward it is, then sign. The camera stays on
 * between customers so a queue moves quickly.
 */
export function TaskScanner({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectRef = useRef<Detect | null>(null);
  const pausedRef = useRef(false);

  const [camOn, setCamOn] = useState(false);
  const [camStarting, setCamStarting] = useState(false);
  const [step, setStep] = useState<Step>("ready");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  function scanLoop() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const v = videoRef.current;
      if (!streamRef.current || !v || !detectRef.current) return;
      if (!pausedRef.current) {
        try {
          const raw = await detectRef.current(v);
          if (raw && NONCE_RE.test(raw.toLowerCase())) {
            navigator.vibrate?.(40);
            await lookup({ nonce: raw.toLowerCase() });
          }
        } catch { /* a missed frame; keep going */ }
      }
      scanLoop();
    }, SCAN_EVERY_MS);
  }

  async function startCamera() {
    setMsg(""); setCamStarting(true);
    try {
      detectRef.current ??= await makeDetector();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      pausedRef.current = false;
      setCamOn(true);
      scanLoop();
    } catch {
      setStep("error");
      setMsg("Couldn't open the camera. Allow camera access, or type the 6-digit code below.");
      stopCamera();
    } finally {
      setCamStarting(false);
    }
  }

  async function lookup(q: { nonce?: string; code?: string }) {
    pausedRef.current = true;
    setStep("checking"); setMsg(""); setPeek(null);
    try {
      const qs = q.code ? `code=${q.code}` : `nonce=${q.nonce}`;
      const res = await fetch(`/api/task/peek?${qs}`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setStep("error"); setMsg(d.error ?? "Couldn't read that code. Try again."); return; }
      if (address && d.ownerAddress && d.ownerAddress.toLowerCase() !== address.toLowerCase()) {
        setStep("error"); setMsg("This reward belongs to a different shop."); return;
      }
      if (!d.claimable) { setStep("error"); setMsg("This reward has already been claimed or has expired."); return; }
      setPeek(d as Peek);
      setStep("confirm");
    } catch {
      setStep("error"); setMsg("Network error. Try again.");
    }
  }

  async function approve() {
    if (!peek) return;
    if (!address) { setStep("error"); setMsg("Connect your shop's wallet first."); return; }
    setStep("approving"); setMsg("");
    try {
      // Always sign the long one-time code, never the short one, so a signature
      // can't be reused if the same six digits come up again later.
      const signature = await signMessageAsync({ message: approveMessage(peek.nonce) });
      const res = await fetch("/api/task/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce: peek.nonce, merchantWallet: address, signature }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) { setStep("done"); setManual(""); navigator.vibrate?.([30, 40, 30]); }
      else { setStep("error"); setMsg(d.error ?? "Couldn't approve. Try again."); }
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "";
      setStep("confirm");
      setMsg(/reject|denied|cancel/i.test(m) ? "You cancelled the signature. Nothing was approved." : "Couldn't approve. Try again.");
    }
  }

  /** Back to scanning for the next customer (camera stays on). */
  function next() {
    setStep("ready"); setPeek(null); setMsg(""); setManual("");
    pausedRef.current = false;
  }

  const close = () => { stopCamera(); onClose(); };
  const manualDigits = manual.replace(/\D/g, "");
  const busy = step === "checking" || step === "approving";

  return (
    <Sheet title="Approve a reward" onClose={close} dismissible={step !== "approving"} width={440}>
      <div className="flex flex-col gap-y-5 pt-6">
        {/* Camera */}
        <div className="relative rounded-3xl overflow-hidden bg-surface aspect-square">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ display: camOn ? "block" : "none" }} />
          {!camOn && step === "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
              <span className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-heading">
                <QrCode className="w-6 h-6" strokeWidth={1.75} />
              </span>
              <p className="text-sm/[140%] text-nav-muted">Scan the customer&apos;s code, or type the 6 digits under it.</p>
            </div>
          )}
          {camOn && step === "ready" && (
            <div aria-hidden className="absolute inset-8 rounded-2xl border-2 border-white/90 pointer-events-none" />
          )}

          {/* Result over the camera, so the merchant never loses their place */}
          {step !== "ready" && (
            <div className={`absolute inset-0 ${camOn ? "bg-white/95" : "bg-surface"} flex flex-col items-center justify-center text-center gap-4 px-6`} role="status" aria-live="polite">
              {step === "checking" && (<><Loader2 className="w-8 h-8 animate-spin text-heading" /><p className="text-base/none text-heading">Checking the code…</p></>)}
              {(step === "confirm" || step === "approving") && peek && (
                <>
                  <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center"><Gift className="w-6 h-6" strokeWidth={1.75} /></span>
                  <p className="text-sm/none text-nav-muted">{peek.spotName ?? "Your shop"}</p>
                  <p className="text-xl/[130%] text-heading break-words">{peek.task}</p>
                  <p className="text-[32px]/none text-brand">{formatG$(BigInt(peek.amountWei))} <span className="text-base/none">G$</span></p>
                  <p className="text-sm/[140%] text-nav-muted">Did they do this? Approving lets them claim the G$.</p>
                </>
              )}
              {step === "done" && (
                <>
                  <span className="success-pop w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center"><Check className="w-8 h-8" strokeWidth={2.25} /></span>
                  <p className="text-xl/none text-heading">Approved</p>
                  <p className="text-sm/[140%] text-nav-muted">They can claim their G$ now.</p>
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

        {msg && step === "confirm" && <p role="alert" className="-mt-2 text-sm/[140%] text-danger text-center">{msg}</p>}

        {/* Actions */}
        {step === "confirm" || step === "approving" ? (
          <div className="flex gap-2">
            <button type="button" onClick={next} disabled={step === "approving"}
              className="h-14 flex-1 rounded-full border border-line bg-white text-base/none text-heading cursor-pointer hover:bg-surface disabled:opacity-60">
              Not yet
            </button>
            <button type="button" onClick={approve} disabled={step === "approving"}
              className="h-14 flex-[2] rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 disabled:bg-[#A4A4A4]">
              {step === "approving" && <Loader2 className="w-5 h-5 animate-spin" />}
              {step === "approving" ? "Confirm in your wallet…" : "Approve"}
            </button>
          </div>
        ) : step === "done" || step === "error" ? (
          <button type="button" onClick={next}
            className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer hover:bg-brand/90">
            {camOn ? "Scan the next customer" : "Done"}
          </button>
        ) : camOn ? (
          <button type="button" onClick={stopCamera}
            className="w-full h-12 rounded-full border border-line bg-white text-sm/none text-heading flex items-center justify-center gap-2 cursor-pointer hover:bg-surface">
            <CameraOff className="w-4 h-4" strokeWidth={1.75} /> Turn off camera
          </button>
        ) : (
          <button type="button" onClick={startCamera} disabled={camStarting}
            className="w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 disabled:bg-[#A4A4A4]">
            {camStarting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" strokeWidth={1.75} />}
            {camStarting ? "Opening camera…" : "Scan a code"}
          </button>
        )}

        {/* Typed fallback: works on every phone, with or without a camera */}
        {(step === "ready" || step === "error") && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manualDigits.length === 6) lookup({ code: manualDigits }); }}>
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
      </div>
    </Sheet>
  );
}
