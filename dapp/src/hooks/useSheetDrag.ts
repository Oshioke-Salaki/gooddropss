"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

interface Options {
  /** Called once the sheet has finished animating off-screen. */
  onDismiss: () => void;
  /** Media query for the viewports where the sheet behaves as a sheet. */
  media?: string;
  /** Distance in px past which releasing dismisses instead of snapping back. */
  threshold?: number;
  /** Downward speed in px/ms that dismisses regardless of distance (a flick). */
  flick?: number;
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const DURATION = 340;

const matches = (q: string) =>
  typeof window !== "undefined" && window.matchMedia(q).matches;

const reducedMotion = () => matches("(prefers-reduced-motion: reduce)");

/**
 * Swipe-down-to-dismiss for a bottom sheet, plus its slide-up entrance.
 *
 * Entrance and drag share ONE transform. They have to: a CSS `animation` with
 * `fill-mode: both` keeps overriding inline styles after it finishes, so a
 * keyframed entrance would permanently outrank the drag offset. Driving both
 * from here keeps them in the same coordinate space.
 *
 * Only active while `media` matches (the same panel is an in-flow card on
 * desktop, which must never translate), and re-evaluated on resize so crossing
 * the breakpoint mid-gesture can't strand the sheet off-screen.
 *
 * Attach `sheetRef` + `sheetStyle` to the sheet, and `handleProps` to whatever
 * you want to be grabbable — typically the header.
 */
export function useSheetDrag({
  onDismiss,
  media = "(max-width: 1023px)",
  threshold = 96,
  flick = 0.55,
}: Options) {
  const [enabled, setEnabled] = useState(() => matches(media));
  const [y, setY] = useState<number | string>(() =>
    matches(media) && !reducedMotion() ? "100%" : 0,
  );
  const [dragging, setDragging] = useState(false);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const start = useRef(0);
  const last = useRef({ y: 0, t: 0 });
  const closing = useRef(false);

  // Track the breakpoint. Dropping to desktop mid-drag resets the offset so the
  // card can't render translated in the flex row.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(media);
    const sync = () => {
      setEnabled(mq.matches);
      if (!mq.matches) { setY(0); setDragging(false); }
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [media]);

  // Slide up on mount. Two frames: the first commits translateY(100%) to the
  // compositor, the second animates away from it. One frame can get coalesced
  // into the initial paint, and the sheet would simply appear.
  useEffect(() => {
    if (!enabled || reducedMotion()) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setY(0)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    // Mount only — re-running on `enabled` would replay the entrance on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (reducedMotion()) { onDismiss(); return; }
    // Past its own height, so it clears the viewport whatever the content is.
    setY((sheetRef.current?.offsetHeight ?? 600) + 48);
    window.setTimeout(onDismiss, DURATION * 0.7);
  }, [onDismiss]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || closing.current) return;
    // Let the close button (and any other control in the header) get its click.
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = performance.now();
    start.current = e.clientY;
    last.current = { y: e.clientY, t };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [enabled]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragging) return;
    // Downward only — dragging up shouldn't peel the sheet off the bottom edge.
    setY(Math.max(0, e.clientY - start.current));
    last.current = { y: e.clientY, t: performance.now() };
  }, [dragging]);

  const end = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragging) return;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }

    const travelled = Math.max(0, e.clientY - start.current);
    const dt = performance.now() - last.current.t;
    // Velocity from the LAST move only: pausing before release should settle the
    // sheet, not fling it, even after a fast swipe earlier in the gesture.
    const velocity = dt > 120 ? 0 : (e.clientY - last.current.y) / Math.max(1, dt);

    if (travelled > threshold || velocity > flick) close();
    else setY(0);
  }, [dragging, threshold, flick, close]);

  const sheetStyle: CSSProperties = enabled
    ? {
        transform: `translateY(${typeof y === "number" ? `${y}px` : y})`,
        transition: dragging ? "none" : `transform ${DURATION}ms ${EASE}`,
        willChange: dragging ? "transform" : undefined,
      }
    : {};

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    // Claim the vertical gesture from the browser's own scroll/pull-to-refresh.
    style: enabled ? ({ touchAction: "none", cursor: dragging ? "grabbing" : "grab" } as CSSProperties) : undefined,
  };

  return { sheetRef, sheetStyle, handleProps, dragging, enabled, close };
}
