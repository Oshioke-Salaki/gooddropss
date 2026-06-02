"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X } from "lucide-react";
import { useAccount } from "wagmi";
import { usePushSubscription } from "@/hooks/usePushSubscription";

const DISMISSED_KEY = "gd_push_dismissed";

export function PushPermissionBanner() {
  const { isConnected } = useAccount();
  const { status, subscribe } = usePushSubscription();
  const [show, setShow]       = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected) return;
    if (status === "subscribed" || status === "denied" || status === "unsupported") return;
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {}
    // Small delay so it doesn't appear immediately on load
    const t = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(t);
  }, [isConnected, status]);

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
    setShow(false);
  }

  async function handleAllow() {
    setLoading(true);
    const ok = await subscribe();
    setLoading(false);
    if (ok) setShow(false);
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 380 }}
          style={{
            position: "fixed",
            top: "64px",
            left: "12px",
            right: "12px",
            zIndex: 1099,
            background: "#111111",
            border: "2px solid #BFFD00",
            borderRadius: 16,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            fontFamily: "inherit",
          }}
        >
          <div style={{
            width: 40, height: 40,
            background: "#BFFD0020",
            border: "1.5px solid #BFFD0044",
            borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Bell size={18} color="#BFFD00" />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#fff" }}>
              Get notified when drops appear
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>
              Know when your drops are claimed too
            </p>
          </div>

          <button
            onClick={handleAllow}
            disabled={loading}
            style={{
              background: "#BFFD00", color: "#111",
              border: "none", borderRadius: 10,
              padding: "8px 14px",
              fontWeight: 900, fontSize: 12,
              cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "…" : "Allow"}
          </button>

          <button
            onClick={dismiss}
            style={{
              background: "none", border: "none",
              cursor: "pointer", color: "#444",
              display: "flex", alignItems: "center",
              padding: 4, flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
