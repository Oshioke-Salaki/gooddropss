"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { approveMessage } from "@/lib/taskCreateMsg";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (res.ok && d.ok) setResult({ ok: true, msg: "Approved ✓ — the hunter can claim their reward now." });
      else setResult({ ok: false, msg: d.error ?? "Couldn't approve — try again." });
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string }).shortMessage ?? "";
      setResult({ ok: false, msg: /rejected|denied/i.test(m) ? "You cancelled the signature." : "Couldn't approve — try again." });
    } finally {
      busyRef.current = false; setBusy(false); stopCamera(); setManual("");
    }
  }

  return (
    <div className="border-2 border-ink rounded-2xl p-4 bg-card shadow-brutal-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-black text-sm">📷 Scan &amp; approve</p>
        <button onClick={() => { stopCamera(); onClose(); }} className="w-7 h-7 rounded-full border-2 border-ink font-bold text-xs">✕</button>
      </div>

      {result && (
        <div className={`rounded-xl border-2 border-ink px-3 py-2.5 text-sm font-bold ${result.ok ? "bg-lime text-ink" : "bg-danger/10 text-danger"}`}>
          {result.msg}
        </div>
      )}

      {/* Camera view */}
      <div className="relative rounded-xl overflow-hidden border-2 border-ink bg-ink/5" style={{ aspectRatio: "1 / 1" }}>
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ display: camActive ? "block" : "none" }} />
        {!camActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4">
            <span className="text-4xl">🎁</span>
            <p className="text-xs text-muted">Point the camera at the hunter&apos;s code, or type it below.</p>
          </div>
        )}
        {camActive && <div className="absolute inset-6 border-2 border-lime rounded-lg pointer-events-none" />}
      </div>

      {supported ? (
        camActive
          ? <button onClick={stopCamera} className="btn-brutal w-full py-2.5 rounded-xl font-black text-sm bg-ink text-cream">Stop camera</button>
          : <button onClick={startCamera} disabled={busy} className="btn-brutal w-full py-2.5 rounded-xl font-black text-sm bg-lime text-ink">Start camera</button>
      ) : (
        <p className="text-[11px] text-muted text-center">Camera scanning isn&apos;t supported on this browser — type the code instead.</p>
      )}

      {/* Manual fallback */}
      <div className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value.trim().toLowerCase())} placeholder="Enter code manually"
          className="flex-1 border-2 border-ink rounded-xl px-3 py-2.5 text-sm font-mono outline-none" />
        <button onClick={() => approve(manual)} disabled={busy || !NONCE_RE.test(manual)}
          className="btn-brutal px-4 rounded-xl font-black text-sm bg-lime text-ink disabled:opacity-50">
          {busy ? "…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
