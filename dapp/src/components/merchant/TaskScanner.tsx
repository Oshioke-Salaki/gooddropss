"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Check, Loader2, QrCode, AlertCircle } from "lucide-react";
import { approveMessage } from "@/lib/taskCreateMsg";
import { Sheet } from "@/components/ui/Sheet";

const NONCE_RE = /^[0-9a-f]{32}$/;

// Merchant scans a hunter's one-time QR (or types the code) → signs → approves.
// Uses the native BarcodeDetector where available (Chrome/Android — the merchant
// target) and always offers manual entry as a universal fallback.
export function TaskScanner({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const busyRef = useRef(false);

  const [supported, setSupported] = useState(false);
  const [camActive, setCamActive] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
    return () => stopCamera();
     
  }, []);

  function stopCamera() {
    scanningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamActive(false);
  }

  async function startCamera() {
    setResult(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      scanningRef.current = true; setCamActive(true);

      const tick = async () => {
        if (!scanningRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const raw = codes?.[0]?.rawValue?.trim();
          if (raw && NONCE_RE.test(raw) && !busyRef.current) { await approve(raw); return; }
        } catch { /* frame miss — keep scanning */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setResult({ ok: false, msg: "Couldn't open the camera — enter the code below instead." });
      stopCamera();
    }
  }

  async function approve(nonce: string) {
    if (!address) { setResult({ ok: false, msg: "Connect your merchant wallet first." }); return; }
    if (!NONCE_RE.test(nonce)) { setResult({ ok: false, msg: "That doesn't look like a valid code." }); return; }
    busyRef.current = true; setBusy(true);
    try {
      const signature = await signMessageAsync({ message: approveMessage(nonce) });
      const res = await fetch("/api/task/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce, merchantWallet: address, signature }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) setResult({ ok: true, msg: "Approved — the hunter can claim their reward now." });
      else setResult({ ok: false, msg: d.error ?? "Couldn't approve — try again." });
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string }).shortMessage ?? "";
      setResult({ ok: false, msg: /rejected|denied/i.test(m) ? "You cancelled the signature." : "Couldn't approve — try again." });
    } finally {
      busyRef.current = false; setBusy(false); stopCamera(); setManual("");
    }
  }

  const close = () => { stopCamera(); onClose(); };

  return (
    <Sheet title="Scan & approve" onClose={close} dismissible={!busy} width={440}>
      <div className="flex flex-col gap-y-5 pt-6">
        {result && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm/[140%] ${
              result.ok ? "bg-brand-soft text-brand" : "bg-[#FFF0F0] text-danger"
            }`}
          >
            {result.ok
              ? <Check className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={2} />
              : <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={2} />}
            <span>{result.msg}</span>
          </div>
        )}

        {/* Camera view */}
        <div className="relative rounded-3xl overflow-hidden bg-surface aspect-square">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ display: camActive ? "block" : "none" }}
          />
          {!camActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
              <span className="w-14 h-14 rounded-full bg-white flex items-center justify-center text-heading">
                <QrCode className="w-6 h-6" strokeWidth={1.75} />
              </span>
              <p className="text-sm/[140%] text-nav-muted">
                Point the camera at the hunter&apos;s code, or type it below.
              </p>
            </div>
          )}
          {camActive && (
            <div aria-hidden className="absolute inset-8 rounded-2xl border-2 border-white/90 pointer-events-none" />
          )}
        </div>

        {supported ? (
          camActive ? (
            <button
              type="button"
              onClick={stopCamera}
              className="w-full h-12 rounded-full border border-line bg-white text-sm/none text-heading cursor-pointer
                motion-safe:transition-colors hover:bg-surface"
            >
              Stop camera
            </button>
          ) : (
            <button
              type="button"
              onClick={startCamera}
              disabled={busy}
              className="w-full h-12 rounded-full bg-brand text-white text-base/none cursor-pointer
                motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed"
            >
              Start camera
            </button>
          )
        ) : (
          <p className="text-sm/[140%] text-nav-muted text-center">
            Camera scanning isn&apos;t supported in this browser — type the code instead.
          </p>
        )}

        {/* Manual fallback */}
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); approve(manual); }}
        >
          <label className="flex-1 min-w-0">
            <span className="sr-only">Reward code</span>
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value.trim().toLowerCase())}
              placeholder="Enter code manually"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              className="w-full h-12 rounded-full bg-surface px-5 text-sm/none text-heading font-mono
                placeholder:text-nav-muted placeholder:font-sans border border-transparent outline-none
                motion-safe:transition-colors focus:border-brand disabled:opacity-60"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !NONCE_RE.test(manual)}
            className="shrink-0 h-12 px-5 rounded-full bg-nav-active text-white text-sm/none cursor-pointer
              flex items-center gap-2 motion-safe:transition-opacity hover:opacity-90
              disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:opacity-100"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy ? "Signing…" : "Approve"}
          </button>
        </form>
      </div>
    </Sheet>
  );
}
