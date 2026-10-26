"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useSheetDrag } from "@/hooks/useSheetDrag";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useEscapeLayer, useFocusReturn, useScrollLock } from "./layers";

interface Props {
  /** Shown in the header. Also the dialog's accessible name. */
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Width of the desktop card. Below lg the sheet is always full-width. */
  width?: number;
  /** False while a save is in flight: backdrop, Escape and swipe all go inert. */
  dismissible?: boolean;
  /** Stacking order. Anything that opens ON TOP of a sheet needs a higher value. */
  zIndex?: number;
  closeLabel?: string;
  /** Replaces the round X — e.g. a "Skip" pill on an onboarding step. */
  headerAction?: React.ReactNode;
}

const subscribeNoop = () => () => {};

/**
 * The one modal container.
 *
 * Below lg it's a bottom sheet: slides up, rides above the keyboard, clears the
 * home indicator, and can be thumbed down from its header to dismiss. At lg and
 * up it's a centred card. Portal, backdrop, Escape, body-scroll lock and focus
 * handling all live here, so a new modal is just a title and some children.
 *
 * The header (title + round X) is rendered here on purpose: every modal in the
 * app has the same one, and keeping it inside the primitive is what lets the
 * header double as the drag handle without each caller wiring that up.
 *
 * Full-bleed rows inside (dividers, lists) use `-mx-6` against the padding.
 */
export function Sheet({
  title,
  onClose,
  children,
  width = 400,
  dismissible = true,
  zIndex = 1400,
  closeLabel = "Close",
  headerAction,
}: Props) {
  const { sheetRef, sheetStyle, handleProps, enabled, close } = useSheetDrag({
    onDismiss: onClose,
  });
  // Only the phone sheet needs lifting above the keyboard — the desktop card is
  // centred in a viewport the browser already resizes.
  const kbInset = useKeyboardInset(enabled);

  // Animate out on the phone (the drag hook owns that transform); on desktop
  // the card has no exit motion, so unmount straight away rather than waiting
  // out an animation nobody can see.
  const dismiss = useCallback(() => {
    if (!dismissible) return;
    if (enabled) close();
    else onClose();
  }, [dismissible, enabled, close, onClose]);

  // Escape closes only the top layer; the page behind stays locked until the
  // last layer closes; focus moves in on open and back to the opener on close.
  // Shared with every other overlay via ui/layers so stacked layers agree.
  // The portal targets document.body, which doesn't exist on the server. Render
  // nothing until hydration is done so the server HTML and the first client
  // render agree (otherwise a sheet that's open on first paint is a hydration
  // mismatch); the layer hooks wait for the same moment, so focus lands on a
  // node that exists.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  useEscapeLayer(mounted, dismiss);
  useScrollLock(mounted);
  useFocusReturn(mounted, sheetRef);

  if (!mounted) return null;

  return createPortal(
    <div
      onClick={dismiss}
      className="modal-fade-in fixed inset-0 bg-[#0000000A] backdrop-blur-md font-sans
        flex items-end justify-center lg:items-center lg:p-6"
      style={{ zIndex }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="modal-rise w-full bg-white rounded-t-3xl p-6 outline-none
          max-h-[85dvh] overflow-y-auto overscroll-contain
          lg:rounded-3xl lg:max-h-[calc(100dvh-48px)] lg:max-w-[calc(100vw-48px)]"
        style={{
          width: enabled ? undefined : width,
          boxShadow: "0px 0px 12px 0px #0000000A",
          paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
          marginBottom: enabled ? kbInset : undefined,
          transition: enabled && kbInset ? "margin-bottom 0.12s ease-out" : undefined,
          ...sheetStyle,
        }}
      >
        {/* Header doubles as the drag handle. handleProps ignores pointerdowns
            on buttons, so tapping X closes rather than starting a drag. */}
        <div {...(dismissible ? handleProps : {})}>
          <span
            aria-hidden
            className="lg:hidden block w-9 h-1 mx-auto -mt-2 mb-4 rounded-full bg-line"
          />
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl/none text-heading truncate">{title}</h2>
            {headerAction ?? (
            <button
              type="button"
              onClick={dismiss}
              disabled={!dismissible}
              aria-label={closeLabel}
              className="shrink-0 p-1.5 rounded-full bg-surface text-black cursor-pointer
                motion-safe:transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
            )}
          </div>
        </div>

        {children}
      </div>
    </div>,
    document.body,
  );
}
