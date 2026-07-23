"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, X, Loader2 } from "lucide-react";
import { useReferral } from "@/hooks/useReferral";

// Shown to a verified newcomer who arrived via an invite link. One tap credits
// their friend (a signature, no gas). Also the mount point that captures the
// ?ref param on the homepage. Renders nothing until it's genuinely actionable.
export function ReferralPrompt() {
  const { canAccept, accepting, acceptReferral } = useReferral();
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);

  const show = canAccept && !dismissed;

  async function accept() {
    const ok = await acceptReferral();
    if (ok) { setDone(true); setTimeout(() => setDismissed(true), 1800); }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
          style={{
            position: "fixed", left: "50%", transform: "translateX(-50%)",
            bottom: "calc(84px + env(safe-area-inset-bottom))", zIndex: 1200,
            width: "min(440px, calc(100vw - 24px))",
            background: "#111", color: "#fff", border: "2px solid #BFFD00",
            borderRadius: 16, padding: "12px 12px 12px 16px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", gap: 12,
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, background: "#BFFD0022", border: "1.5px solid #BFFD0055", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Gift size={18} color="#BFFD00" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 13.5 }}>
              {done ? "Thanks — credited! 🎉" : "You were invited!"}
            </p>
            <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "#9a9da8" }}>
              {done ? "Happy hunting." : "Tap to credit the friend who brought you."}
            </p>
          </div>
          {!done && (
            <button onClick={accept} disabled={accepting}
              style={{ flexShrink: 0, height: 38, padding: "0 14px", background: "#BFFD00", color: "#111", border: "none", borderRadius: 10, fontWeight: 900, fontSize: 13, cursor: accepting ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
              {accepting ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : "Accept"}
            </button>
          )}
          <button onClick={() => setDismissed(true)} aria-label="Dismiss"
            style={{ flexShrink: 0, width: 30, height: 30, background: "none", border: "none", color: "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
