"use client";
import { useRef, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { Share2, Download, Check, Loader2 } from "lucide-react";
import { formatG$, RARITY, X_HANDLES, X_HASHTAGS, type DropRarity } from "@/lib/utils";
import { withRef } from "@/lib/referral";
import { prefersNativeShare } from "@/lib/share";

interface Props {
  amount:   bigint;
  rarity:   DropRarity;
  place?:   string | null;   // clue / place name
  handle:   string;          // hunter handle or short address
  dropId:   string;
  /** Public URL of the app, used in share text. */
  siteUrl?: string;
}

const CARD_W = 1080;
const CARD_H = 1080;
const BRAND = "#2727E2";
const HEADING = "#121607";
const MUTED = "#6B6E63";

/**
 * Post-claim shareable card. Draws a branded 1080×1080 image on a canvas and
 * offers native share (with the image file where supported) plus X / Warpcast
 * fallbacks. Everything is client-side — no server round-trip.
 */
export function ShareableClaimCard({ amount, rarity, place, handle, dropId, siteUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied]   = useState(false);
  const [busy, setBusy]       = useState(false);
  const { address } = useAccount();
  const r = RARITY[rarity];

  const url = siteUrl ?? (typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz");
  // Carry the sharer's referral code → a claim tweet also recruits.
  const shareUrl  = withRef(`${url}/drop/${dropId}`, address);
  const shareText = `I just found ${formatG$(amount)} G$ hidden in the real world on GoodDrops. Real money, real places. Come hunt with me:\n\n${X_HANDLES}\n${X_HASHTAGS}`;

  // ── Draw the card onto the canvas and return a Blob ──────────────────────
  const renderToBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const font = "'DM Sans', system-ui, sans-serif";

    // Soft page background, white card, same shadow language as the app.
    ctx.fillStyle = "#F5F5F5";
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.06)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.roundRect(60, 60, CARD_W - 120, CARD_H - 120, 48);
    ctx.fill();
    ctx.restore();

    // Brand row: blue square mark + wordmark
    ctx.fillStyle = BRAND;
    ctx.beginPath();
    ctx.roundRect(120, 120, 64, 64, 18);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 34px ${font}`;
    ctx.textAlign = "center";
    ctx.fillText("G$", 152, 164);
    ctx.textAlign = "left";
    ctx.fillStyle = HEADING;
    ctx.font = `500 44px ${font}`;
    ctx.fillText("GoodDrops", 204, 167);

    // Rarity tag (pill) — tinted with the rarity colour as a dot, text in brand
    ctx.textAlign = "center";
    const tag = r.label.toUpperCase();
    ctx.font = `600 26px ${font}`;
    const tagW = ctx.measureText(tag).width + 86;
    ctx.fillStyle = "#F5F5F5";
    ctx.beginPath();
    ctx.roundRect(CARD_W / 2 - tagW / 2, 270, tagW, 56, 28);
    ctx.fill();
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(CARD_W / 2 - tagW / 2 + 32, 298, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HEADING;
    ctx.fillText(tag, CARD_W / 2 + 14, 307);

    // "I JUST FOUND"
    ctx.fillStyle = MUTED;
    ctx.font = `500 36px ${font}`;
    ctx.fillText("I just found", CARD_W / 2, 410);

    // Amount — the hero
    ctx.fillStyle = HEADING;
    ctx.font = `700 230px ${font}`;
    const amtStr = formatG$(amount);
    const amtWidth = ctx.measureText(amtStr).width;
    ctx.font = `700 100px ${font}`;
    const unitWidth = ctx.measureText(" G$").width;
    const startX = CARD_W / 2 - (amtWidth + unitWidth) / 2;
    ctx.textAlign = "left";
    ctx.font = `700 230px ${font}`;
    ctx.fillText(amtStr, startX, 620);
    ctx.fillStyle = BRAND;
    ctx.font = `700 100px ${font}`;
    ctx.fillText(" G$", startX + amtWidth, 612);

    // Place / clue
    ctx.textAlign = "center";
    if (place) {
      ctx.fillStyle = HEADING;
      ctx.font = `500 38px ${font}`;
      const clue = place.length > 42 ? place.slice(0, 40) + "…" : place;
      ctx.fillText(`“${clue}”`, CARD_W / 2, 730);
    }

    // Hunter handle
    ctx.fillStyle = MUTED;
    ctx.font = `500 34px ${font}`;
    ctx.fillText(`found by ${handle}`, CARD_W / 2, 810);

    // Bottom tagline
    ctx.fillStyle = BRAND;
    ctx.font = `600 38px ${font}`;
    ctx.fillText("Real money. Real places.", CARD_W / 2, 930);
    ctx.fillStyle = MUTED;
    ctx.font = `500 30px ${font}`;
    ctx.fillText("gooddrops.xyz", CARD_W / 2, 980);

    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }, [amount, place, handle, r]);

  const handleShare = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderToBlob();
      const file = blob ? new File([blob], "gooddrops-claim.png", { type: "image/png" }) : null;

      // Phones: the native sheet, with the image where the platform takes files.
      // Desktop browsers often expose navigator.share but refuse it, so they skip
      // straight to the X intent below.
      if (prefersNativeShare()) {
        try {
          if (file && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], text: shareText, url: shareUrl });
          } else {
            await navigator.share({ text: shareText, url: shareUrl });
          }
          return;
        } catch (e) {
          if ((e as { name?: string } | null)?.name === "AbortError") return; // cancelled
          // refused — fall through to the X intent
        }
      }
      // Desktop fallback → X intent
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch {
      /* user cancelled share — no-op */
    } finally {
      setBusy(false);
    }
  }, [renderToBlob, shareText, shareUrl]);

  const handleDownload = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderToBlob();
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `gooddrops-${dropId}.png`;
      a.click();
      URL.revokeObjectURL(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setBusy(false);
    }
  }, [renderToBlob, dropId]);

  return (
    <div className="w-full font-sans">
      {/* Hidden canvas used for image generation */}
      <canvas ref={canvasRef} width={CARD_W} height={CARD_H} className="hidden" />

      {/* No preview mini-card here on purpose. It used to restate "I JUST FOUND
          40 G$" directly beneath the success hero's "You found it! 40 G$" — the
          same number twice, ~200px apart, in two different styles. The 1080×1080
          image is still drawn on the hidden canvas above and attached by Share /
          Download, so nothing is lost by not mocking it up on screen. */}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleShare}
          disabled={busy}
          className="flex-1 h-12 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2
            cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-wait"
        >
          {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Share2 className="w-[18px] h-[18px]" strokeWidth={2} />}
          {busy ? "Preparing…" : "Share my win"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy}
          aria-label="Download image"
          title="Download image"
          className="w-12 h-12 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center cursor-pointer
            motion-safe:transition-colors hover:bg-nav-controls disabled:cursor-wait"
        >
          {copied ? <Check className="w-[18px] h-[18px] text-brand" strokeWidth={2} /> : <Download className="w-[18px] h-[18px]" strokeWidth={2} />}
        </button>
      </div>

      {/* The preview is gone, so say plainly that an image goes with the share. */}
      <p className="mt-3 text-xs/none text-nav-muted text-center">
        Shares a card image of your {formatG$(amount)} G$ find
      </p>
    </div>
  );
}
