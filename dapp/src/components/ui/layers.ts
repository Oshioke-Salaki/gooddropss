"use client";
import { useEffect, useRef } from "react";

// Shared plumbing for everything that sits on top of the page: Sheets, the
// wallet panel, the profile drawer, the badge viewer, the location picker.
// Each concern lives here once, so overlays that stack (wallet → Send G$,
// drawer → badge, edit profile → avatar picker) agree on who owns Escape,
// when the page may scroll again, and where focus goes back to.

// ── Escape ────────────────────────────────────────────────────────────────────

// Open layers in the order they opened. Only the last one reacts to Escape.
// Mount order is also visual order here, so no z-index bookkeeping is needed.
const escapeStack: symbol[] = [];

/**
 * Close the TOP layer on Escape, and only the top one.
 *
 * Listens in the capture phase and stops the event once handled, so a layer
 * underneath (or a plain document listener elsewhere) never sees the same
 * press. `onEscape` may return `false` to decline — the key then continues to
 * whatever is focused (e.g. an input that cancels its own edit).
 */
export function useEscapeLayer(active: boolean, onEscape: () => boolean | void) {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const me = Symbol("layer");
    escapeStack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escapeStack[escapeStack.length - 1] !== me) return;
      if (handler.current() === false) return;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = escapeStack.indexOf(me);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

// ── Scroll lock ───────────────────────────────────────────────────────────────

// Reference-counted: the page unlocks when the LAST layer closes, not the first.
// The old per-component "save prev, restore prev" pattern broke whenever layers
// closed out of order (open A, open B, close A → page scrolls under B).
let lockCount = 0;
let savedOverflow = "";

/** Stop the page behind from scrolling while `active`. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, [active]);
}

// ── Focus ─────────────────────────────────────────────────────────────────────

/**
 * Move focus into the layer when it opens, and back to whatever opened it when
 * it closes — so keyboard and screen-reader users land on the dialog rather
 * than behind it, and pick up where they left off afterwards.
 *
 * The target should be focusable (`tabIndex={-1}` on a container is enough).
 */
export function useFocusReturn(active: boolean, target: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const opener = document.activeElement as HTMLElement | null;
    target.current?.focus({ preventScroll: true });
    return () => {
      // The opener may have unmounted with the layer (e.g. a row in a list
      // that re-rendered); only hand focus back if it's still on the page.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active, target]);
}
