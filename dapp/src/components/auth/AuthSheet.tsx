"use client";
import { useEffect } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { ArrowLeft, X } from "lucide-react";
import { useSheetDrag } from "@/hooks/useSheetDrag";

interface Props {
  title: string;
  /** Renders a back chevron in the header when provided. */
  onBack?: () => void;
  onClose: () => void;
  /**
   * When false, a backdrop click or Escape won't dismiss — used while a login is
   * in flight, so a stray tap can't tear the sheet down mid-handshake. The X
   * always closes regardless, so nobody can get stuck.
   */
  dismissible?: boolean;
  children: React.ReactNode;
}

const ROUND_BTN =
  "w-8 h-8 shrink-0 rounded-full bg-surface text-nav-muted flex items-center justify-center " +
  "cursor-pointer motion-safe:transition-colors hover:bg-nav-controls hover:text-heading";

/**
 * The auth modal's chrome: blurred overlay, card, header, keyboard lift.
 *
 * Below lg it's a bottom sheet inset 16px from the edges, draggable down to
 * dismiss; at lg and up a centred 400px card. Both views (sign-in, wallet
 * chooser) render inside it, so the card never remounts when you move between
 * them — only the body swaps.
 */
export function AuthSheet({
  title,
  onBack,
  onClose,
  dismissible = true,
  children,
}: Props) {
  // Below lg the card is a bottom sheet: slides up on open, thumb it down from
  // the header to dismiss. Inert at lg and up, where it's a centred card.
  const { sheetRef, sheetStyle, handleProps, enabled: isSheet } = useSheetDrag({ onDismiss: onClose });

  // Lift the card above the on-screen keyboard. On iOS and in in-app wallet
  // browsers (Valora/MiniPay) a `fixed` overlay stays anchored to the FULL page
  // height — the keyboard doesn't shrink it — so the email field would sit
  // behind the keyboard. Padding the overlay's bottom by the keyboard height
  // lifts the sheet clear of it.
  const kb = useKeyboardInset();

  // Stop the page behind from scrolling — on iOS that scroll drags the overlay.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, dismissible]);

  return (
    <div
      onClick={dismissible ? onClose : undefined}
      className="modal-fade-in fixed inset-0 z-[2000] flex items-end justify-center px-4
        bg-[#0000000A] backdrop-blur-md font-sans
        lg:items-center"
      style={{
        // As a sheet, keep the 16px bottom gutter and stack the keyboard inset on
        // top of it. Centred on desktop, the inset alone lifts the card.
        paddingBottom: isSheet ? kb + 16 : kb,
        transition: "padding-bottom 0.12s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={sheetRef}
        style={sheetStyle}
        className="modal-rise w-full max-w-[400px] max-h-full overflow-y-auto bg-white rounded-3xl py-6 shadow-[0px_0px_12px_0px_#0000000A]"
      >
        {/* With a back button the title is centred between the two 32px controls
            (a 3-column grid keeps it truly centred, not just "after the arrow").
            Without one it sits left, opposite the close button. */}
        <header
          {...handleProps}
          className={`px-6 items-center gap-3 ${
            onBack ? "grid grid-cols-[2rem_1fr_2rem]" : "flex justify-between"
          }`}
        >
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className={ROUND_BTN}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className={`text-xl/none text-heading truncate ${onBack ? "text-center" : ""}`}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={ROUND_BTN}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {children}
      </div>
    </div>
  );
}
