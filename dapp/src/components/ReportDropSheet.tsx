"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSignMessage } from "wagmi";
import { X, Loader2, Flag, Check } from "lucide-react";
import { REPORT_REASONS, REPORT_DETAIL_MAX, type ReportReason } from "@/lib/reports";
import { submitReport } from "@/lib/reportClient";

interface Props {
  dropId: string | null;   // null = closed
  onClose: () => void;
}

// Lets a verified hunter flag a bad drop. Server enforces the verified-human
// gate; here we just surface its message if the signer isn't verified.
export function ReportDropSheet({ dropId, onClose }: Props) {
  const { signMessageAsync } = useSignMessage();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState("");

  useEffect(() => {
    if (dropId) { setReason(null); setDetail(""); setBusy(false); setDone(false); setError(""); }
  }, [dropId]);

  useEffect(() => {
    if (!dropId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [dropId]);

  async function submit() {
    if (!dropId || !reason || busy) return;
    setBusy(true); setError("");
    try {
      await submitReport((m) => signMessageAsync({ message: m }), { dropId, reason, detail: detail.trim() || undefined });
      setDone(true);
      setTimeout(onClose, 1300);
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as Error)?.message ?? "";
      setError(/reject|denied|cancel/i.test(m) ? "" : (m || "Couldn't send report. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {dropId && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }} onClick={busy ? undefined : onClose}
            style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(17,17,17,0.6)", backdropFilter: "blur(3px)" }}
          />
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 34, stiffness: 430 }}
            role="dialog" aria-modal="true" aria-label="Report drop"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 4001,
              width: "100%", maxWidth: 480, margin: "0 auto",
              background: "#f5f4f0", borderRadius: "24px 24px 0 0",
              border: "2px solid #111", borderBottom: "none",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.35)",
              padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
              maxHeight: "92dvh", overflowY: "auto",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <div style={{ width: 40, height: 4, borderRadius: 999, background: "#d6d5cf", margin: "0 auto 14px" }} />

            {done ? (
              <div style={{ textAlign: "center", padding: "20px 8px" }}>
                <div style={{ fontSize: 44, marginBottom: 6 }}>🙏</div>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 19, color: "#111" }}>Report sent</p>
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6b6e7a" }}>Thanks — our team will take a look.</p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, border: "2px solid #111", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFE5E5" }}>
                      <Flag size={16} color="#C81E1E" />
                    </span>
                    <div>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 18, color: "#111", letterSpacing: "-0.02em" }}>Report this drop</p>
                      <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "#888", fontWeight: 600 }}>What&rsquo;s wrong with it?</p>
                    </div>
                  </div>
                  <button onClick={busy ? undefined : onClose} aria-label="Close" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, border: "2px solid #111", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <X size={16} color="#111" />
                  </button>
                </div>

                {/* Reasons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                  {REPORT_REASONS.map((r) => {
                    const active = reason === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => { setReason(r.id); setError(""); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, width: "100%",
                          padding: "12px 14px", borderRadius: 13, cursor: "pointer",
                          border: `2px solid ${active ? "#111" : "#e0ded6"}`,
                          background: active ? "#111" : "#fff",
                          color: active ? "#fff" : "#111",
                          fontFamily: "inherit", fontWeight: 800, fontSize: 14,
                          boxShadow: active ? "none" : "2px 2px 0 rgba(17,17,17,0.08)",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ fontSize: 17 }}>{r.icon}</span>
                        <span>{r.label}</span>
                        {active && <Check size={16} style={{ marginLeft: "auto" }} />}
                      </button>
                    );
                  })}
                </div>

                {/* Optional detail */}
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Add any detail (optional)"
                  maxLength={REPORT_DETAIL_MAX}
                  rows={2}
                  style={{
                    marginTop: 12, width: "100%", boxSizing: "border-box",
                    background: "#fff", border: "2px solid #e0ded6", borderRadius: 12,
                    padding: "10px 12px", fontSize: 14, fontWeight: 600, color: "#333",
                    fontFamily: "inherit", outline: "none", resize: "none",
                  }}
                />

                {error && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#dc2626", fontWeight: 700 }}>{error}</p>}

                <button
                  onClick={submit}
                  disabled={!reason || busy}
                  style={{
                    marginTop: 14, width: "100%", height: 52,
                    background: reason ? "#C81E1E" : "#e8e7e2",
                    color: reason ? "#fff" : "#a8a8a2",
                    border: "2.5px solid", borderColor: reason ? "#111" : "#d6d5cf",
                    borderRadius: 15, fontWeight: 900, fontSize: 16, fontFamily: "inherit",
                    cursor: reason && !busy ? "pointer" : "not-allowed",
                    boxShadow: reason ? "4px 4px 0 #111" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {busy
                    ? <><Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> Sending…</>
                    : <><Flag size={16} /> Submit report</>}
                </button>
                <p style={{ margin: "9px 0 0", fontSize: 11, color: "#9a9da8", textAlign: "center" }}>
                  You sign to confirm — free, no gas. Verified hunters only.
                </p>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
