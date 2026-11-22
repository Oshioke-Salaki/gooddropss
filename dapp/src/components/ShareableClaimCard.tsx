"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Loader2, Share2, X } from "lucide-react";
import { formatG$, type DropRarity } from "@/lib/utils";
import { withRef } from "@/lib/referral";
import { prefersNativeShare, copyText } from "@/lib/share";
import { renderWinCard, winShareText } from "@/lib/winCard";
import { getWithdrawInfo, nairaFor } from "@/lib/withdrawInfo";
import { toast } from "@/lib/toast";

interface Props {
  amount: bigint;
  rarity: DropRarity;
  /** The drop's clue or place. */
  place?: string | null;
  /** "@name" or a short address. */
  handle: string;
  dropId: string;
  /** Public URL of the app, used in the invite link. */
  siteUrl?: string;
}

/** How long to wait for the naira rate before drawing the card without it. */
const RATE_WAIT_MS = 1500;

/**
 * After a claim: the win card is drawn at once (lib/winCard: a 9:16 image for
 * WhatsApp and Instagram Status, with the naira value in Nigeria and a QR code
 * carrying the hunter's invite link), shown as a preview, and shared in one tap.
 * Phones get the native share sheet with the image; a computer saves the image
 * and copies the message.
 */
export function ShareableClaimCard({ amount, rarity, place, handle, dropId, siteUrl }: Props) {
  const { address } = useAccount();
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<"drawing" | "ready" | "failed">("drawing");
  const [naira, setNaira] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const origin = siteUrl ?? (typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz");
  // The sharer's invite code rides on every link: a win post also recruits.
  const inviteUrl = withRef(`${origin}/drop/${dropId}`, address);
  const text = winShareText({ amount, naira });

  // Draw once: wait briefly for the naira rate (Nigeria only), then render.
  useEffect(() => {
    let gone = false;
    let url: string | null = null;
    (async () => {
      const g = Number(amount / 10n ** 14n) / 10_000; // whole G$ with 4 decimals, no float overflow
      const info = await Promise.race([
        getWithdrawInfo(),
        new Promise<null>((r) => setTimeout(() => r(null), RATE_WAIT_MS)),
      ]);
      const n = info && info.inNigeria && info.nairaPerG ? nairaFor(g, info.nairaPerG) : null;
      if (gone) return;
      setNaira(n);
      try {
        const b = await renderWinCard(
          { amount, rarity, place: place?.trim() || null, handle, naira: n, date: new Date() },
          qrRef.current,
        );
        if (gone) return;
        url = URL.createObjectURL(b);
        setBlob(b);
        setPreview(url);
        setState("ready");
      } catch (e) {
        console.error("[win card]", e);
        if (!gone) setState("failed");
      }
    })();
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [amount, rarity, place, handle]);

  const save = useCallback(() => {
    if (!preview) return false;
    const a = document.createElement("a");
    a.href = preview;
    a.download = `gooddrops-win-${dropId}.png`;
    a.click();
    return true;
  }, [preview, dropId]);

  const share = useCallback(async () => {
    setBusy(true);
    try {
      if (prefersNativeShare()) {
        const file = blob ? new File([blob], `gooddrops-win-${dropId}.png`, { type: "image/png" }) : null;
        try {
          // With a file, many apps drop the separate URL field: keep the link in the text.
          if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: `${text} ${inviteUrl}` });
          else await navigator.share({ text, url: inviteUrl });
          return;
        } catch (e) {
          if ((e as { name?: string } | null)?.name === "AbortError") return; // they changed their mind
          // Refused (some in-app browsers): fall through to save + copy.
        }
      }
      const saved = save();
      const copied = await copyText(`${text} ${inviteUrl}`);
      if (saved && copied) toast.success("Card saved and message copied", { description: "Post the image and paste the message." });
      else if (copied) toast.success("Message copied", { description: "Paste it anywhere to invite people." });
      else toast.error("Couldn't share from this browser", { description: "Long-press the card to save it." });
    } finally {
      setBusy(false);
    }
  }, [blob, dropId, inviteUrl, save, text]);

  // The lightbox closes on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="w-full font-sans">
      {/* The invite QR, drawn into the card. Off-screen, never shown. */}
      <div aria-hidden className="absolute w-0 h-0 overflow-hidden">
        <QRCodeCanvas ref={qrRef} value={inviteUrl} size={268} marginSize={0} level="M" fgColor="#121607" bgColor="#FFFFFF" />
      </div>

      <div className="flex items-center gap-4 rounded-2xl bg-surface p-3 text-left">
        <button
          type="button"
          onClick={() => preview && setOpen(true)}
          disabled={!preview}
          aria-label="View your win card"
          className="relative w-[60px] h-[106px] shrink-0 rounded-xl overflow-hidden bg-brand cursor-pointer
            shadow-[0_6px_16px_rgba(39,39,226,0.3)] disabled:cursor-default
            motion-safe:transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not a remote image */}
          {preview && <img src={preview} alt="" className="w-full h-full object-cover motion-safe:animate-[gd-card-in_.4s_ease_both]" />}
          {state === "drawing" && <span className="absolute inset-0 animate-pulse bg-brand/80" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-base/[130%] text-heading">Your win card</p>
          <p className="mt-1 text-sm/[140%] text-nav-muted">
            {state === "failed" ? "Couldn't draw it here. Sharing still sends the link." : "Made for WhatsApp Status. Your invite link is on it."}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={share}
          disabled={busy || state === "drawing"}
          className="flex-1 h-12 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer
            motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-wait"
        >
          {busy || state === "drawing" ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Share2 className="w-[18px] h-[18px]" strokeWidth={2} />}
          {state === "drawing" ? "Making your card" : "Share my win"}
        </button>
        <button
          type="button"
          onClick={() => { if (save()) toast.success("Card saved"); }}
          disabled={!preview}
          aria-label="Save the card"
          title="Save the card"
          className="w-12 h-12 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center cursor-pointer
            motion-safe:transition-colors hover:bg-nav-controls disabled:opacity-50 disabled:cursor-default"
        >
          <Download className="w-[18px] h-[18px]" strokeWidth={2} />
        </button>
      </div>

      {open && preview && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Your win card: ${formatG$(amount)} G$`}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[6000] flex flex-col items-center justify-center gap-5 p-5 bg-[#0B0C29]/85 backdrop-blur-md
            motion-safe:animate-[gd-fade-in_.2s_ease_both]"
        >
          <button type="button" onClick={() => setOpen(false)} aria-label="Close"
            className="absolute top-[max(16px,env(safe-area-inset-top))] right-4 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center cursor-pointer hover:bg-white/20">
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL */}
          <img src={preview} alt={`Win card: ${formatG$(amount)} G$`} onClick={(e) => e.stopPropagation()}
            className="max-h-[72dvh] w-auto max-w-full rounded-3xl shadow-[0_24px_60px_rgba(0,0,0,0.5)] motion-safe:animate-[gd-card-in_.35s_cubic-bezier(.2,.9,.3,1.1)_both]" />
          <div className="flex gap-3 w-full max-w-[360px]" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={share} disabled={busy}
              className="flex-1 h-12 rounded-full bg-white text-heading text-base/none flex items-center justify-center gap-2 cursor-pointer hover:bg-white/90 disabled:cursor-wait">
              {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Share2 className="w-[18px] h-[18px]" strokeWidth={2} />}
              Share my win
            </button>
            <button type="button" onClick={() => { if (save()) toast.success("Card saved"); }} aria-label="Save the card"
              className="w-12 h-12 shrink-0 rounded-full bg-white/10 text-white flex items-center justify-center cursor-pointer hover:bg-white/20">
              <Download className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
