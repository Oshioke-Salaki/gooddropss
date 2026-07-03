"use client";
import { useRef, useState, useCallback } from "react";
import { Share2, Download, Check } from "lucide-react";
import { formatG$, RARITY, type DropRarity } from "@/lib/utils";

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

/**
 * Post-claim shareable card. Draws a branded 1080×1080 image on a canvas and
 * offers native share (with the image file where supported) plus X / Warpcast
 * fallbacks. Everything is client-side — no server round-trip.
 */
export function ShareableClaimCard({ amount, rarity, place, handle, dropId, siteUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied]   = useState(false);
  const [busy, setBusy]       = useState(false);
  const r = RARITY[rarity];

  const url = siteUrl ?? (typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz");
  const shareUrl  = `${url}/drop/${dropId}`;
  const shareText = `I just found ${formatG$(amount)} G$ hidden in the real world on GoodDrops 🎯💰 Real money, real places. Come hunt with me:`;

  // ── Draw the card onto the canvas and return a Blob ──────────────────────
  const renderToBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const font = "'Space Grotesk', system-ui, sans-serif";

    // Background
    ctx.fillStyle = "#0a0b12";
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Rarity glow blob
    const grad = ctx.createRadialGradient(CARD_W / 2, 430, 40, CARD_W / 2, 430, 520);
    grad.addColorStop(0, `${r.color}55`);
    grad.addColorStop(1, "#0a0b1200");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Top brand row
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 46px ${font}`;
    ctx.fillText("good", 90, 130);
    ctx.fillStyle = r.color;
    ctx.fillRect(232, 92, 150, 54);
    ctx.fillStyle = "#0a0b12";
    ctx.font = `900 40px ${font}`;
    ctx.fillText("drops.", 248, 132);

    // Rarity badge
    ctx.textAlign = "center";
    ctx.fillStyle = r.color;
    ctx.font = `900 30px ${font}`;
    ctx.fillText(r.label.toUpperCase(), CARD_W / 2, 300);

    // "I FOUND"
    ctx.fillStyle = "#7c7f92";
    ctx.font = `700 40px ${font}`;
    ctx.fillText("I JUST FOUND", CARD_W / 2, 400);

    // Amount — the hero
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 240px ${font}`;
    const amtStr = formatG$(amount);
    ctx.fillText(amtStr, CARD_W / 2 - 40, 620);
    ctx.fillStyle = r.color;
    ctx.font = `900 120px ${font}`;
    const amtWidth = ctx.measureText(amtStr).width;
    ctx.textAlign = "left";
    ctx.fillText(" G$", CARD_W / 2 - 40 + amtWidth / 2 + 20, 600);

    // Place / clue
    ctx.textAlign = "center";
    if (place) {
      ctx.fillStyle = "#c9ccda";
      ctx.font = `600 38px ${font}`;
      const clue = place.length > 42 ? place.slice(0, 40) + "…" : place;
      ctx.fillText(`“${clue}”`, CARD_W / 2, 730);
    }

    // Hunter handle
    ctx.fillStyle = "#7c7f92";
    ctx.font = `700 34px ${font}`;
    ctx.fillText(`found by ${handle}`, CARD_W / 2, 810);

    // Bottom tagline
    ctx.fillStyle = r.color;
    ctx.font = `900 40px ${font}`;
    ctx.fillText("Real money. Real places.", CARD_W / 2, 960);
    ctx.fillStyle = "#7c7f92";
    ctx.font = `600 32px ${font}`;
    ctx.fillText("gooddrops.xyz", CARD_W / 2, 1010);

    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }, [amount, place, handle, r]);

  const handleShare = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderToBlob();
      const file = blob ? new File([blob], "gooddrops-claim.png", { type: "image/png" }) : null;

      // Native share with image where the platform supports files
      if (
        file &&
        typeof navigator !== "undefined" &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({ files: [file], text: shareText, url: shareUrl });
        return;
      }
      // Plain native share (no file)
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ text: shareText, url: shareUrl });
        return;
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
    <div style={{ width: "100%" }}>
      {/* Hidden canvas used for image generation */}
      <canvas ref={canvasRef} width={CARD_W} height={CARD_H} style={{ display: "none" }} />

      {/* Visible preview mini-card */}
      <div
        style={{
          background: "#0a0b12",
          borderRadius: 16,
          border: "2px solid #111",
          padding: "18px 16px",
          textAlign: "center",
          marginBottom: 12,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(circle at 50% 40%, ${r.color}33, transparent 60%)`,
            pointerEvents: "none",
          }}
        />
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: r.color, position: "relative" }}>
          {r.label.toUpperCase()}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 700, color: "#7c7f92", position: "relative" }}>
          I JUST FOUND
        </p>
        <p style={{ margin: "2px 0 0", position: "relative" }}>
          <span style={{ fontSize: 44, fontWeight: 900, color: "#fff" }}>{formatG$(amount)}</span>
          <span style={{ fontSize: 24, fontWeight: 900, color: r.color }}> G$</span>
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 11, fontWeight: 700, color: "#7c7f92", position: "relative" }}>
          Real money. Real places. · gooddrops.xyz
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleShare}
          disabled={busy}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: "#111", color: "#BFFD00",
            border: "2px solid #111", borderRadius: 12,
            padding: "13px", fontWeight: 800, fontSize: 14,
            cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
            boxShadow: "3px 3px 0 #BFFD00",
          }}
        >
          <Share2 size={16} />
          {busy ? "Preparing…" : "Share my win"}
        </button>
        <button
          onClick={handleDownload}
          disabled={busy}
          aria-label="Download image"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#f5f4f0", color: "#111",
            border: "2px solid #111", borderRadius: 12,
            padding: "13px 16px", fontWeight: 800, fontSize: 14,
            cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
          }}
        >
          {copied ? <Check size={16} /> : <Download size={16} />}
        </button>
      </div>
    </div>
  );
}
