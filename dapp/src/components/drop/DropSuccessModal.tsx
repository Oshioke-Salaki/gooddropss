"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, X } from "lucide-react";
import { dropTier } from "@/components/map/markers";

interface Props {
  /** Whole-G$ amount of a single drop, as typed. */
  amount: string;
  /** Wei value of ONE drop — drives the tier colour on the value chip. */
  amountWei: bigint;
  qty: number;
  placeName: string | null;
  isPrivate: boolean;
  /** Null for a scattered batch (no single drop to link) or if the id was missed. */
  shareUrl: string | null;
  /** Recovered from an earlier session: the original amount and place are gone,
   *  so neither may be shown — a confident "10 G$" there would be a lie. */
  resuming: boolean;
  onShare: () => void;
  onClose: () => void;
}

/** X (formerly Twitter) mark. Inlined — it's one path, and it inherits colour. */
function XLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * Shown once a drop is live. Replaces the drawer rather than sitting inside it —
 * the job has changed from "configure a drop" to "share it", and a centred modal
 * says that more clearly than a form that suddenly reads differently.
 *
 * Two panes: the drop itself on the left, the link to it on the right. The right
 * pane disappears entirely for a scattered batch, which has no single URL to
 * point at — showing an empty QR frame there would be worse than showing none.
 */
export function DropSuccessModal({
  amount, amountWei, qty, placeName, isPrivate, shareUrl, resuming, onShare, onClose,
}: Props) {
  const [copied, setCopied] = useState(false);

  // Mirrors the drawer: fade out before unmounting, so closing doesn't just blink.
  const [exiting, setExiting] = useState(false);
  const requestClose = useCallback(() => {
    setExiting((already) => {
      if (!already) window.setTimeout(onClose, 200);
      return true;
    });
  }, [onClose]);

  const copy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked (insecure origin, or denied) — the URL is on screen
         and selectable, so there's still a way to take it. */
    }
  }, [shareUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [requestClose]);

  if (typeof document === "undefined") return null;

  const tier = dropTier(amountWei);
  // A resumed drop's amount is unknown, and a batch's chip would misread as the
  // batch total rather than the per-drop value.
  const showValue = !resuming && amountWei > 0n && qty === 1;

  return createPortal(
    <div
      onClick={requestClose}
      className={`${exiting ? "modal-fade-out" : "modal-fade-in"} fixed inset-0 z-[1500] flex items-end justify-center bg-[#0000000A] font-sans backdrop-blur-md lg:items-center lg:p-5`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Drop successful"
        className="modal-rise max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-[0px_0px_12px_0px_#0000000A] lg:max-h-none lg:w-[720px] lg:rounded-3xl"
      >
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-xl/none text-heading">
            {qty > 1 ? `${qty} drops successful` : "Drop successful"}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded-full bg-surface p-1.5 text-nav-muted motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col rounded-2xl border border-line lg:flex-row">
          {/* ── The drop ── */}
          <div
            className={`flex flex-col justify-end p-6 ${
              shareUrl ? "border-b border-line lg:w-[55%] lg:border-b-0 lg:border-r" : "w-full"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/treasure-chest-lg.png"
              alt=""
              width={160}
              height={160}
              className="mx-auto mb-4 h-32 w-32 lg:h-40 lg:w-40"
            />

            {/* Same reading as the map pill: where it is, and what's in it. */}
            <div className="mb-6 flex items-center gap-x-2 rounded-full bg-surface p-1 pr-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/location-pin.svg" alt="" width={28} height={45}
                   className="-mt-4 h-[45px] w-7 shrink-0 select-none" />
              <span className="min-w-0 flex-1 truncate text-sm/none text-heading">
                {placeName ?? (isPrivate ? "Private spot" : "Chosen spot")}
              </span>
              {showValue && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/treasure-chest.png" alt="" width={32} height={32}
                       className="h-8 w-8 shrink-0" />
                  <span
                    className="shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-xs/none"
                    style={{ background: tier.bg, borderColor: tier.border, color: tier.text }}
                  >
                    {amount} G$
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={onShare}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-nav-active py-[22px] text-base/none text-white motion-safe:transition-opacity hover:opacity-90"
            >
              Post on
              <XLogo className="h-4 w-4" />
            </button>
          </div>

          {/* ── The link ── */}
          {shareUrl && (
            <div className="flex flex-1 flex-col p-6">
              <div className="mb-6 flex flex-1 items-center justify-center">
                {/* Scales to the pane instead of a fixed px size, so it stays
                    square and scannable at every width. */}
                <QRCodeSVG
                  value={shareUrl}
                  level="M"
                  className="h-auto w-full max-w-[257px]"
                  style={{ aspectRatio: "1 / 1", height: "auto" }}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 flex-1 truncate text-sm/none text-heading" title={shareUrl}>
                  {shareUrl}
                </p>
                <button
                  type="button"
                  onClick={copy}
                  aria-label="Copy drop link"
                  className="shrink-0 cursor-pointer text-nav-active motion-safe:transition-colors hover:text-brand"
                >
                  {copied ? <Check className="h-5 w-5 text-brand" /> : <Copy className="h-5 w-5" />}
                </button>
              </div>

              <p className="mt-3 text-xs/[150%] text-nav-muted">
                {isPrivate
                  ? "Only people with this link can find the drop."
                  : "Scan or share to jump straight to the drop."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
