"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { usePushSubscription } from "@/hooks/usePushSubscription";

const DISMISSED_KEY = "gd_push_dismissed";

/**
 * One-time nudge to turn on drop alerts, a few seconds after sign-in.
 * `preview` forces it visible for design QA; production never passes it.
 */
export function PushPermissionBanner({ preview = false }: { preview?: boolean } = {}) {
  const { isConnected } = useAccount();
  const { status, subscribe } = usePushSubscription();
  const [show, setShow]       = useState(preview);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (preview) return;
    if (!isConnected) return;
    if (status === "subscribed" || status === "denied" || status === "unsupported") return;
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {}
    // Small delay so it doesn't appear immediately on load
    const t = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(t);
  }, [isConnected, status, preview]);

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
    setShow(false);
  }

  async function handleAllow() {
    setLoading(true);
    setError("");
    const ok = await subscribe();
    setLoading(false);
    if (ok) {
      setShow(false);
    } else {
      setError("Could not connect to push service. Try Chrome or check your network.");
    }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -24, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 380 }}
          role="status"
          className="fixed z-[1099] left-3 right-3 lg:left-auto lg:right-[60px] lg:w-[440px] font-sans
            bg-white rounded-2xl shadow-[0px_0px_12px_0px_#0000000A] p-3 pr-2
            flex items-center gap-3"
          style={{
            top: "calc(var(--spacing-nav) + var(--gd-banner-h, 0px) + 12px)",
            transition: "top 0.2s ease",
          }}
        >
          <span className="w-10 h-10 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Bell className="w-[18px] h-[18px]" strokeWidth={2} />
          </span>

          <div className="flex-1 min-w-0 flex flex-col gap-y-1.5">
            <p className="text-sm/none text-heading truncate">Get alerts when drops appear near you</p>
            <p className={`text-xs/[130%] ${error ? "text-danger" : "text-nav-muted"}`}>
              {error || "Uses your approximate location. Know when your drops are claimed too."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleAllow}
            disabled={loading}
            className="shrink-0 h-9 px-4 rounded-full bg-brand text-white text-sm/none flex items-center gap-2
              cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-wait"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Allow"}
          </button>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Not now"
            className="w-8 h-8 shrink-0 rounded-full bg-surface text-nav-muted flex items-center justify-center
              cursor-pointer motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
