"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Coins, MapPin, Target } from "lucide-react";

const STORAGE_KEY = "gd_onboarded";

const SLIDES = [
  {
    Icon: Coins,
    eyebrow: "Welcome to",
    title: "good drops.",
    body: "The real-world treasure hunt powered by GoodDollar. G$ is hidden at real GPS locations — go find it.",
    cta: "How it works →",
  },
  {
    Icon: MapPin,
    eyebrow: "Step 1",
    title: "Drop G$",
    body: "Tap \"Drop G$\", pick any spot on the map, set an amount and leave a clue. Your G$ is locked on-chain until someone claims it.",
    cta: "Next →",
  },
  {
    Icon: Target,
    eyebrow: "Step 2",
    title: "Hunt & Claim",
    body: "Walk to a drop on the map. Get within 100 metres and the Claim button lights up. First person there wins the G$.",
    cta: "Start hunting →",
  },
];

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [slide, setSlide]     = useState(0);
  const [dir, setDir]         = useState(1);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {}
  }, []);

  function advance() {
    if (slide < SLIDES.length - 1) {
      setDir(1);
      setSlide((s) => s + 1);
    } else {
      finish();
    }
  }

  function finish() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  const { Icon, eyebrow, title, body, cta } = SLIDES[slide];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(17,17,17,0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 360,
          background: "#f5f4f0",
          border: "2.5px solid #111",
          borderRadius: 24,
          boxShadow: "6px 6px 0 #111",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Skip */}
        {slide < SLIDES.length - 1 && (
          <button
            onClick={finish}
            style={{
              position: "absolute", top: 16, right: 18,
              background: "none", border: "none",
              color: "#999", fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Skip
          </button>
        )}

        {/* Slide */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={slide}
            initial={{ x: dir * 56, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -56, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 380 }}
            style={{
              padding: "40px 28px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            {/* Icon circle */}
            <div
              style={{
                width: 80, height: 80,
                background: "#BFFD00",
                border: "2.5px solid #111",
                borderRadius: "50%",
                boxShadow: "3px 3px 0 #111",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 24,
                flexShrink: 0,
              }}
            >
              <Icon size={36} strokeWidth={2} color="#111111" />
            </div>

            {/* Eyebrow */}
            <p style={{
              margin: "0 0 6px",
              fontSize: 11, fontWeight: 800,
              color: "#888",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}>
              {eyebrow}
            </p>

            {/* Title */}
            <h2 style={{
              margin: "0 0 14px",
              fontSize: 30, fontWeight: 900,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              color: "#111",
            }}>
              {title}
            </h2>

            {/* Body */}
            <p style={{
              margin: "0 0 32px",
              fontSize: 15, lineHeight: 1.6,
              color: "#555", fontWeight: 500,
            }}>
              {body}
            </p>

            {/* CTA */}
            <button
              onClick={advance}
              style={{
                width: "100%", padding: "15px",
                background: "#111", color: "#BFFD00",
                border: "2.5px solid #111",
                boxShadow: "3px 3px 0 #BFFD00",
                borderRadius: 14,
                fontWeight: 900, fontSize: 15,
                cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center",
                justifyContent: "center",
              }}
            >
              {cta}
            </button>
          </motion.div>
        </AnimatePresence>

        {/* Dot indicators */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          gap: 6,
          paddingBottom: 22,
        }}>
          {SLIDES.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === slide ? 22 : 7,
                height: 7,
                borderRadius: 4,
                background: i === slide ? "#111" : "#ccc",
                transition: "width 0.25s ease, background 0.25s ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
