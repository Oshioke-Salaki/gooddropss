"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Coins, MapPin, Target } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";

const STORAGE_KEY = "gd_onboarded";

const SLIDES = [
  {
    Icon: Coins,
    eyebrow: "Welcome to",
    title: "GoodDrops",
    body: "The real-world treasure hunt powered by GoodDollar. G$ is hidden at real GPS locations — go find it.",
    cta: "How it works",
  },
  {
    Icon: MapPin,
    eyebrow: "Step 1",
    title: "Drop G$",
    body: "Tap \"Drop G$\", pick any spot on the map, set an amount and leave a clue. Your G$ is locked on-chain until someone claims it.",
    cta: "Next",
  },
  {
    Icon: Target,
    eyebrow: "Step 2",
    title: "Hunt & claim",
    body: "Walk to a drop on the map. Get within 100 metres and the Claim button lights up. First person there wins the G$.",
    cta: "Start hunting",
  },
];

/**
 * Three welcome slides for a brand-new device. Shown once; dismissing in any
 * way (Skip, X, backdrop, the last CTA) marks the device onboarded.
 */
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
  const last = slide === SLIDES.length - 1;

  return (
    <Sheet
      title={title}
      onClose={finish}
      zIndex={2000}
      headerAction={
        last ? undefined : (
          <button
            type="button"
            onClick={finish}
            className="shrink-0 h-8 px-4 rounded-full bg-surface text-sm/none text-heading cursor-pointer
              motion-safe:transition-colors hover:bg-nav-controls"
          >
            Skip
          </button>
        )
      }
    >
      <div className="overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={slide}
            initial={{ x: dir * 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -40, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 380 }}
            className="flex flex-col items-center text-center pt-8"
          >
            <span className="w-20 h-20 rounded-full bg-brand-soft text-brand flex items-center justify-center">
              <Icon className="w-9 h-9" strokeWidth={1.75} />
            </span>
            <p className="mt-5 text-xs/none text-nav-muted uppercase tracking-[0.08em]">{eyebrow}</p>
            <p className="mt-4 text-sm/[150%] text-nav-muted max-w-[320px]">{body}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={advance}
        className="mt-8 w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2
          cursor-pointer motion-safe:transition-colors hover:bg-brand/90"
      >
        {cta}
        <ArrowRight className="w-5 h-5" strokeWidth={2} />
      </button>

      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 mt-5" aria-hidden>
        {SLIDES.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full motion-safe:transition-all motion-safe:duration-300 ${
              i === slide ? "w-6 bg-brand" : "w-1.5 bg-line"
            }`}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">Step {slide + 1} of {SLIDES.length}</p>
    </Sheet>
  );
}
