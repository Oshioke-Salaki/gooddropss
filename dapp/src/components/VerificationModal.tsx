"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { VerificationStatus } from "@/hooks/useVerification";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  fvLink: string | null;
  status: VerificationStatus;
  onRefresh: () => void;
}

export function VerificationModal({ isOpen, onClose, fvLink, status, onRefresh }: Props) {
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => { setIframeLoaded(false); }, [fvLink]);

  // Auto-close 2 seconds after verification confirmed
  useEffect(() => {
    if (status === "verified" && isOpen) {
      const t = setTimeout(() => onClose(), 2000);
      return () => clearTimeout(t);
    }
  }, [status, isOpen, onClose]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "unset";
    return () => { document.body.style.overflow = "unset"; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 1100,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px",
        }}
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ position: "absolute", inset: 0, background: "rgba(17,17,17,0.82)", backdropFilter: "blur(3px)" }}
        />

        {/* Modal card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "relative",
            width: "100%", maxWidth: "520px",
            height: "min(85vh, 680px)",
            background: "#f5f4f0",
            borderRadius: "20px",
            border: "2px solid #111111",
            boxShadow: "4px 4px 0 #111111",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "2px solid #111111",
              background: "#f5f4f0",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "18px" }}>🛡️</span>
              <span style={{ fontWeight: 900, fontSize: "15px", letterSpacing: "-0.01em" }}>
                GoodDollar Verification
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                width: "28px", height: "28px", borderRadius: "50%",
                border: "2px solid #111111", background: "transparent",
                cursor: "pointer", fontWeight: 900, fontSize: "12px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "inherit", lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

            {/* Verified state */}
            {status === "verified" && (
              <div
                style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  padding: "32px", textAlign: "center",
                  background: "#bffd00",
                }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  style={{ fontSize: "64px", marginBottom: "16px" }}
                >
                  🎯
                </motion.div>
                <p style={{ fontWeight: 900, fontSize: "22px", letterSpacing: "-0.02em", marginBottom: "8px", color: "#111" }}>
                  You&apos;re Verified!
                </p>
                <p style={{ fontSize: "14px", color: "#333", lineHeight: 1.5 }}>
                  Your GoodDollar identity is confirmed. You can now claim drops.
                </p>
              </div>
            )}

            {/* FV iframe */}
            {status !== "verified" && fvLink && (
              <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, position: "relative" }}>
                  {!iframeLoaded && (
                    <div
                      style={{
                        position: "absolute", inset: 0, display: "flex",
                        flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px",
                      }}
                    >
                      <div
                        className="animate-spin"
                        style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          border: "3px solid #ddd", borderTopColor: "#111111",
                        }}
                      />
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        Initialising face verification…
                      </span>
                    </div>
                  )}
                  <iframe
                    src={fvLink}
                    style={{
                      width: "100%", height: "100%", border: "none",
                      opacity: iframeLoaded ? 1 : 0,
                      transition: "opacity 0.5s",
                    }}
                    onLoad={() => setIframeLoaded(true)}
                    allow="camera"
                  />
                </div>

                {/* Fallback footer */}
                <div
                  style={{
                    padding: "10px 20px", borderTop: "2px solid #111111",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
                    background: "#f5f4f0", flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Camera not working?
                  </span>
                  <a
                    href={fvLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      padding: "6px 12px",
                      background: "#111111", color: "#bffd00",
                      border: "none", borderRadius: "8px",
                      fontSize: "12px", fontWeight: 800, textDecoration: "none",
                      whiteSpace: "nowrap", fontFamily: "inherit",
                    }}
                  >
                    Open in New Tab ↗
                  </a>
                </div>
              </div>
            )}

            {/* Loading / generating link state */}
            {status !== "verified" && !fvLink && (
              <div
                style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  padding: "32px", textAlign: "center",
                }}
              >
                <div style={{ fontSize: "48px", marginBottom: "20px" }}>🔐</div>
                <p style={{ fontWeight: 900, fontSize: "18px", marginBottom: "8px", letterSpacing: "-0.01em" }}>
                  Connecting to GoodDollar
                </p>
                <p style={{ fontSize: "14px", color: "#666", marginBottom: "28px", lineHeight: 1.5, maxWidth: "280px" }}>
                  Setting up a secure connection for face verification. This may take a moment.
                </p>

                {status === "error" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "200px" }}>
                    <button
                      onClick={onRefresh}
                      style={{
                        padding: "12px 24px", background: "#111111", color: "#bffd00",
                        border: "2px solid #111111", borderRadius: "10px",
                        boxShadow: "2px 2px 0 #bffd00",
                        fontWeight: 900, fontSize: "14px", cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Retry
                    </button>
                    <button
                      onClick={onClose}
                      style={{
                        padding: "12px 24px", background: "transparent", color: "#888",
                        border: "2px solid #ccc", borderRadius: "10px",
                        fontWeight: 700, fontSize: "14px", cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div
                    className="animate-spin"
                    style={{
                      width: "32px", height: "32px", borderRadius: "50%",
                      border: "3px solid #ddd", borderTopColor: "#111111",
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 20px", borderTop: "2px solid #111111",
              textAlign: "center", flexShrink: 0,
            }}
          >
            <p style={{ fontSize: "11px", color: "#888" }}>
              GoodDrops uses GoodDollar for privacy-focused identity verification
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
