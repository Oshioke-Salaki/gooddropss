"use client";
import { useEffect, useState } from "react";

/**
 * Height of the on-screen keyboard, in CSS pixels (0 when it's closed).
 *
 * A `position: fixed` element stays anchored to the FULL layout viewport on iOS
 * and inside in-app wallet browsers (Valora/MiniPay) — the keyboard doesn't
 * shrink it — so a bottom sheet with an input in it ends up behind the keyboard.
 * Offsetting the sheet by this value floats it just above.
 *
 * Returns 0 wherever visualViewport isn't available, which is the correct
 * no-op: those browsers resize the layout viewport themselves.
 *
 * @param active pass false to stop measuring (e.g. while the sheet is closed).
 */
export function useKeyboardInset(active = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!active || typeof window === "undefined") { setInset(0); return; }
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      setInset(0);
    };
  }, [active]);

  return inset;
}
