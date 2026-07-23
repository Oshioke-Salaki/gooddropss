"use client";
import { useRef, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { Share2, Download, Check } from "lucide-react";
import { X_HANDLES, X_HASHTAGS } from "@/lib/utils";
import { withRef } from "@/lib/referral";

interface Props {
  handle:       string; // @username or short address
  gClaimed:     string; // formatted, e.g. "2.3k"
  claims:       number;
  achievements: number;
  totalAch:     number;
  siteUrl?:     string;
}

const CARD = 1080;

/**
 * Shareable hunter card. Draws a branded 1080×1080 image on a canvas and offers
 * native share (with the image file where supported) plus an X fallback. Fully
 * client-side — mirrors ShareableClaimCard.
 */
export function ShareableHunterCard({ handle, gClaimed, claims, achievements, totalAch, siteUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [busy, setBusy]     = useState(false);
  const [copied, setCopied] = useState(false);
  const { address } = useAccount();

  const url = siteUrl ?? (typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz");
  // Referral code = the SHARER's wallet, even when viewing someone else's card.
  const shareUrl  = withRef(typeof window !== "undefined" ? window.location.href : url, address);
  const shareText = `I've found ${gClaimed} G$ across ${claims} real-world hunts on GoodDrops 🎯 Come hunt with me:\n\n${X_HANDLES}\n${X_HASHTAGS}`;

  const renderToBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const font = "'Space Grotesk', system-ui, sans-serif";

    // Background
    ctx.fillStyle = "#0a0b12";
    ctx.fillRect(0, 0, CARD, CARD);
    const grad = ctx.createRadialGradient(CARD / 2, 380, 40, CARD / 2, 380, 560);
    grad.addColorStop(0, "#BFFD0033");
    grad.addColorStop(1, "#0a0b1200");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CARD, CARD);

    // Brand
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 46px ${font}`;
    ctx.fillText("good", 90, 130);
    ctx.fillStyle = "#BFFD00";
    ctx.fillRect(232, 92, 150, 54);
    ctx.fillStyle = "#0a0b12";
    ctx.font = `900 40px ${font}`;
    ctx.fillText("drops.", 248, 132);

    // Handle
    ctx.textAlign = "center";
    ctx.fillStyle = "#BFFD00";
    ctx.font = `900 40px ${font}`;
    ctx.fillText("HUNTER", CARD / 2, 290);
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 66px ${font}`;
    const h = handle.length > 18 ? handle.slice(0, 17) + "…" : handle;
    ctx.fillText(h, CARD / 2, 370);

    // Hero — G$ claimed
    ctx.fillStyle = "#7c7f92";
    ctx.font = `700 34px ${font}`;
    ctx.fillText("TOTAL FOUND", CARD / 2, 500);
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 200px ${font}`;
    ctx.fillText(gClaimed, CARD / 2 - 30, 690);
    ctx.fillStyle = "#BFFD00";
    ctx.font = `900 90px ${font}`;
    const w = ctx.measureText(gClaimed).width;
    ctx.textAlign = "left";
    ctx.fillText(" G$", CARD / 2 - 30 + w / 2 + 16, 670);

    // Stat pills
    ctx.textAlign = "center";
    const pills = [
      { v: String(claims), l: "HUNTS" },
      { v: `${achievements}/${totalAch}`, l: "BADGES" },
    ];
    const pw = 300, gap = 40, startX = CARD / 2 - (pw + gap / 2);
    pills.forEach((p, i) => {
      const x = startX + i * (pw + gap);
      ctx.fillStyle = "#12131d";
      ctx.strokeStyle = "#BFFD0033";
      ctx.lineWidth = 2;
      roundRect(ctx, x, 760, pw, 120, 20);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 52px ${font}`;
      ctx.fillText(p.v, x + pw / 2, 822);
      ctx.fillStyle = "#7c7f92";
      ctx.font = `700 24px ${font}`;
      ctx.fillText(p.l, x + pw / 2, 858);
    });

    // Footer
    ctx.fillStyle = "#BFFD00";
    ctx.font = `900 38px ${font}`;
    ctx.fillText("Real money. Real places.", CARD / 2, 970);
    ctx.fillStyle = "#7c7f92";
    ctx.font = `600 30px ${font}`;
    ctx.fillText("gooddrops.xyz", CARD / 2, 1015);

    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }, [handle, gClaimed, claims, achievements, totalAch]);

  const handleShare = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderToBlob();
      const file = blob ? new File([blob], "gooddrops-hunter.png", { type: "image/png" }) : null;
      if (file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText, url: shareUrl });
        return;
      }
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ text: shareText, url: shareUrl });
        return;
      }
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
        "_blank", "noopener,noreferrer",
      );
    } catch {
      /* user cancelled */
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
      a.download = "gooddrops-hunter.png";
      a.click();
      URL.revokeObjectURL(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setBusy(false);
    }
  }, [renderToBlob]);

  return (
    <div>
      <canvas ref={canvasRef} width={CARD} height={CARD} style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleShare}
          disabled={busy}
          className="btn-brutal"
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: "#111", color: "#BFFD00", borderRadius: 12,
            padding: "13px", fontWeight: 800, fontSize: 14,
            cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
          }}
        >
          <Share2 size={16} />
          {busy ? "Preparing…" : "Share my hunter card"}
        </button>
        <button
          onClick={handleDownload}
          disabled={busy}
          aria-label="Download image"
          className="btn-brutal"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#fff", color: "#111", borderRadius: 12,
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
