"use client";
import { useCallback, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Navigation, Share2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";

interface Props {
  /** Whole-G$ amount of a single drop, as typed. */
  amount: string;
  /** Wei value of ONE drop (zero when unknown, e.g. a recovered session). */
  amountWei: bigint;
  qty: number;
  placeName: string | null;
  isPrivate: boolean;
  /** Null for a scattered batch (no single drop to link) or if the id was missed. */
  shareUrl: string | null;
  /** Recovered from an earlier session: the original amount and place are gone,
   *  so neither may be shown — a confident "10 G$" there would be a lie. */
  resuming: boolean;
  /** Posts to X (the caller builds the text). */
  onShare: () => void;
  onClose: () => void;
  /** How long the drop stays claimable, in seconds (for "Expires in…"). */
  durationSeconds?: number;
  /** Fly the map to the drop. Omitted where there's no map behind the modal. */
  onViewOnMap?: () => void;
}

/** X (formerly Twitter) mark. Inlined — it's one path, and it inherits colour. */
function XLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function humanDuration(s: number): string {
  if (s < 3600 * 1.5) return "1 hour";
  if (s < 86_400) return `${Math.round(s / 3600)} hours`;
  const d = Math.round(s / 86_400);
  return d === 1 ? "24 hours" : `${d} days`;
}

/**
 * The moment a drop goes live.
 *
 * Deliberately short: what's live, where, for how long — then the one job left,
 * telling people. Everything else (clue, rules, reclaiming) lives elsewhere.
 */
export function DropSuccessModal({
  amount, amountWei, qty, placeName, isPrivate, shareUrl, resuming, onShare, onClose,
  durationSeconds, onViewOnMap,
}: Props) {
  const [copied, setCopied] = useState(false);


  const copy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the link is on screen and selectable */ }
  }, [shareUrl]);

  const nativeShare = useCallback(async () => {
    const url = shareUrl ?? window.location.origin;
    const text = isPrivate
      ? "I hid some G$ for you on GoodDrops. Follow the link to find it."
      : qty > 1
        ? `I just hid ${qty} G$ drops on GoodDrops. First verified human there takes it.`
        : `I just hid ${amount} G$ on GoodDrops. First verified human there takes it.`;
    try {
      if (navigator.share) { await navigator.share({ title: "GoodDrops", text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* share sheet dismissed */ }
  }, [shareUrl, isPrivate, qty, amount]);

  const each = Number(amount) || 0;
  const multi = qty > 1;
  const showAmount = !resuming && amountWei > 0n;

  const title = resuming
    ? "Your drop is live"
    : isPrivate
      ? "Your private drop is ready"
      : multi ? `${qty} drops are live` : "Your drop is live";


  return (
    <Sheet title={title} onClose={onClose} width={520} zIndex={1500}>
      {/* ── Hero: what was hidden ─────────────────────────────────────────── */}
      <div className="mt-5 flex items-center gap-4 rounded-2xl bg-surface p-4">
        <div className="relative shrink-0">
          <span aria-hidden className="absolute inset-0 -m-3 rounded-full bg-[radial-gradient(circle,rgba(255,152,37,0.35)_0%,rgba(255,152,37,0)_70%)]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/treasure-chest-lg.png" alt="" width={80} height={80} className="success-pop relative w-18 h-18 lg:w-20 lg:h-20" />
        </div>
        <div className="min-w-0 flex flex-col items-start gap-2">
          <span className="inline-flex items-center gap-2 h-7 px-2.5 rounded-full bg-white text-brand text-xs/none">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-brand opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-brand" />
            </span>
            {isPrivate ? "Locked in, link ready" : "Live on the map"}
          </span>
          {showAmount ? (
            <>
              <p className="font-anta text-[34px]/none lg:text-[38px]/none text-heading whitespace-nowrap">
                {multi ? <>{qty}<span className="text-nav-muted text-[24px]"> × </span>{amount}</> : amount}{" "}
                <span className="text-brand text-[22px]">G$</span>
              </p>
              {multi && <p className="text-sm/none text-nav-muted">{(each * qty).toLocaleString()} G$ in total</p>}
            </>
          ) : (
            <p className="text-sm/[140%] text-nav-muted">Recovered from your last session.</p>
          )}
        </div>
      </div>

      {/* Where and for how long — the two things a dropper checks. */}
      {(placeName || durationSeconds) && !resuming && (
        <p className="mt-4 text-sm/[140%] text-nav-muted text-center">
          {placeName && <span className="text-heading">{placeName}</span>}
          {placeName && durationSeconds ? " · " : ""}
          {durationSeconds ? `Expires in ${humanDuration(durationSeconds)}` : ""}
        </p>
      )}

      {/* ── The link (single drop) ────────────────────────────────────────── */}
      {shareUrl && (
        <div className="mt-4 rounded-2xl border border-line p-4 flex items-center gap-4">
          <div className="shrink-0 rounded-xl border border-line p-2 bg-white">
            <QRCodeSVG value={shareUrl} level="M" size={76} />
          </div>
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <span className="text-xs/none text-nav-muted">{isPrivate ? "Private link" : "Drop link"}</span>
            <p className="text-sm/none text-heading truncate" title={shareUrl}>{shareUrl.replace(/^https?:\/\//, "")}</p>
            <button
              type="button"
              onClick={copy}
              className="self-start h-8 px-3 rounded-full border border-line text-xs/none text-heading flex items-center gap-1.5 cursor-pointer
                motion-safe:transition-colors hover:bg-surface"
            >
              {copied ? <><Check className="w-3.5 h-3.5 text-brand" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={nativeShare}
          className="h-12 rounded-full bg-brand text-white text-sm/none flex items-center justify-center gap-2 cursor-pointer
            motion-safe:transition-colors hover:bg-brand/90"
        >
          <Share2 className="w-4 h-4" strokeWidth={2} /> {isPrivate ? "Send link" : "Share"}
        </button>
        <button
          type="button"
          onClick={onShare}
          className="h-12 rounded-full bg-nav-active text-white text-sm/none flex items-center justify-center gap-2 cursor-pointer
            motion-safe:transition-opacity hover:opacity-90"
        >
          Post on <XLogo className="w-3.5 h-3.5" />
        </button>
        {onViewOnMap && !isPrivate && (
          <button
            type="button"
            onClick={() => { onViewOnMap(); onClose(); }}
            className="h-12 rounded-full border border-line bg-white text-sm/none text-heading flex items-center justify-center gap-2 cursor-pointer
              motion-safe:transition-colors hover:bg-surface"
          >
            <Navigation className="w-4 h-4" strokeWidth={2} /> View on map
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`h-12 rounded-full bg-surface text-sm/none text-heading cursor-pointer motion-safe:transition-colors hover:bg-nav-controls
            ${onViewOnMap && !isPrivate ? "" : "col-span-2"}`}
        >
          Done
        </button>
      </div>
    </Sheet>
  );
}
