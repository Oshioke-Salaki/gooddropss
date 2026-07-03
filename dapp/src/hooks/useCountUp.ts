"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 → `target` over `durationMs` using rAF.
 * Restarts whenever `run` flips to true. Returns the current animated value.
 */
export function useCountUp(target: number, run: boolean, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!run) { setValue(0); return; }

    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const elapsed = ts - start;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic for a satisfying settle
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else setValue(target);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, run, durationMs]);

  return value;
}
