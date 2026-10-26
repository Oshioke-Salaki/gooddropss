"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  QrCode, Copy, Check, Share2, Printer, RefreshCw, Undo2, MapPin, Clock, Lock, Link2,
  Trophy, Target, Gift, Loader2, ExternalLink,
} from "lucide-react";
import {
  formatG$,
  timeLeft,
  gpsToDeg,
  formatDegrees,
  openGoogleMapsWalking,
  parseDropHint,
} from "@/lib/utils";
import { UserHandle } from "@/components/UserHandle";
import { Sheet } from "@/components/ui/Sheet";
import { DROP_STATUS, type Drop } from "@/types";
import { shareOrCopy } from "@/lib/share";

const STATUS_LABEL: Record<number, string> = {
  [DROP_STATUS.Active]: "Active",
  [DROP_STATUS.Claimed]: "Claimed",
  [DROP_STATUS.Reclaimed]: "Reclaimed",
};

export const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A]";

export const PILL =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-line bg-white text-sm/none text-heading " +
  "cursor-pointer motion-safe:transition-colors hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

function Tag({ tone, children }: { tone: "brand" | "muted" | "bad" | "streak"; children: React.ReactNode }) {
  const c =
    tone === "brand" ? "bg-brand-soft text-brand"
    : tone === "bad" ? "bg-[#FFF0F0] text-danger"
    : tone === "streak" ? "bg-streak-bg text-streak"
    : "bg-surface text-nav-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs/none whitespace-nowrap ${c}`}>
      {children}
    </span>
  );
}

/** Location line. Private drops store (0,0) on-chain — showing maps would go to the ocean. */
function LocationRow({ drop, isPrivate }: { drop: Drop; isPrivate: boolean }) {
  if (isPrivate) {
    return (
      <p className="flex items-center gap-2 text-sm/none text-nav-muted">
        <MapPin className="w-4 h-4 shrink-0" strokeWidth={2} /> Location hidden
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openGoogleMapsWalking(gpsToDeg(drop.lat), gpsToDeg(drop.lng))}
      className="flex items-center gap-2 text-sm/none text-nav-muted min-w-0 cursor-pointer
        motion-safe:transition-colors hover:text-heading text-left"
    >
      <MapPin className="w-4 h-4 shrink-0" strokeWidth={2} />
      <span className="truncate">{formatDegrees(drop.lat)} N, {formatDegrees(drop.lng)} E</span>
      <span className="shrink-0 inline-flex items-center gap-1 text-heading">
        Open in Maps <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} />
      </span>
    </button>
  );
}

export function DropCard({
  drop,
  onReclaim,
  onReactivate,
  isReclaiming,
  isReactivating,
  onShare,
}: {
  drop: Drop;
  onReclaim: (id: bigint) => void;
  onReactivate: (id: bigint) => void;
  isReclaiming: boolean;
  isReactivating: boolean;
  onShare: (drop: Drop) => void;
}) {
  const isExpiredActive =
    drop.status === DROP_STATUS.Active &&
    drop.expiry < Math.floor(Date.now() / 1000);
  const isActive =
    drop.status === DROP_STATUS.Active && !isExpiredActive;
  const busy = isReclaiming || isReactivating;
  const { isPrivate, hint: cleanHint, chainNextId, isChainLast } = parseDropHint(drop.hint);
  const isChain = chainNextId !== null || isChainLast;

  return (
    <article className={`${CARD} p-6 flex flex-col gap-y-5 min-w-0`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
            <Gift className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex flex-col gap-y-2">
            <p className="text-lg/none text-heading truncate">
              {formatG$(drop.amount)} <span className="text-nav-muted">G$</span>
            </p>
            <p className="text-sm/none text-nav-muted">Drop #{String(drop.id)}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 shrink-0">
          {isPrivate && !isChain && (
            <Tag tone="muted"><Lock className="w-3.5 h-3.5" strokeWidth={2} /> Private</Tag>
          )}
          {isChain && (
            <Tag tone="muted"><Link2 className="w-3.5 h-3.5" strokeWidth={2} /> Chain</Tag>
          )}
          <Tag tone={isActive ? "brand" : isExpiredActive ? "bad" : "muted"}>
            {isExpiredActive ? "Expired" : STATUS_LABEL[drop.status]}
          </Tag>
        </div>
      </div>

      {cleanHint && (
        <p className="rounded-2xl bg-surface px-4 py-3 text-sm/[140%] text-nav-muted">
          &ldquo;{cleanHint}&rdquo;
        </p>
      )}

      <div className="flex flex-col gap-y-3">
        <LocationRow drop={drop} isPrivate={isPrivate} />
        {isActive && (
          <p className="flex items-center gap-2 text-sm/none text-nav-muted">
            <Clock className="w-4 h-4 shrink-0" strokeWidth={2} /> {timeLeft(drop.expiry)}
          </p>
        )}
        {drop.status === DROP_STATUS.Claimed && drop.claimer && (
          <p className="flex items-center gap-2 text-sm/none text-nav-muted min-w-0">
            <Check className="w-4 h-4 shrink-0 text-brand" strokeWidth={2} />
            <span className="truncate">Claimed by <UserHandle address={drop.claimer} className="text-heading" /></span>
          </p>
        )}
        {isExpiredActive && (
          <p className="flex items-center gap-2 text-sm/none text-nav-muted">
            <Clock className="w-4 h-4 shrink-0" strokeWidth={2} /> Reactivate it, or reclaim your G$
          </p>
        )}
      </div>

      {isExpiredActive && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => !busy && onReactivate(drop.id)}
            disabled={busy}
            className="sm:flex-1 h-12 rounded-full bg-brand text-white text-sm/none cursor-pointer flex items-center justify-center gap-2
              motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
          >
            {isReactivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" strokeWidth={1.75} />}
            {isReactivating ? "Reactivating…" : "Reactivate"}
          </button>
          <button
            type="button"
            onClick={() => !busy && onReclaim(drop.id)}
            disabled={busy}
            className={`${PILL} sm:flex-1 h-12`}
          >
            {isReclaiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" strokeWidth={1.75} />}
            {isReclaiming ? "Reclaiming…" : `Reclaim ${formatG$(drop.amount)} G$`}
          </button>
        </div>
      )}

      {/* Share / QR + Print sticker buttons */}
      <div className="flex gap-2">
        <button type="button" onClick={() => onShare(drop)} className={`${PILL} flex-1`}>
          <QrCode className="w-4 h-4" strokeWidth={1.75} /> Share
        </button>
        <a
          href={`/drop/${drop.id}/sticker`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${PILL} flex-1`}
        >
          <Printer className="w-4 h-4" strokeWidth={1.75} /> Print sticker
        </a>
      </div>
    </article>
  );
}

export function ClaimCard({ drop, onShare }: { drop: Drop; onShare: (drop: Drop) => void }) {
  const { hint: cleanHint, isChainLast } = parseDropHint(drop.hint);
  return (
    <article className={`${CARD} p-6 flex flex-col gap-y-5 min-w-0`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
            <Target className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex flex-col gap-y-2">
            <p className="text-lg/none text-heading truncate">
              {formatG$(drop.amount)} <span className="text-nav-muted">G$</span>
            </p>
            <p className="text-sm/none text-nav-muted">Drop #{String(drop.id)}</p>
          </div>
        </div>
        <Tag tone="brand">
          {isChainLast
            ? <><Trophy className="w-3.5 h-3.5" strokeWidth={2} /> Hunt complete</>
            : <><Check className="w-3.5 h-3.5" strokeWidth={2} /> Claimed</>}
        </Tag>
      </div>

      {cleanHint && (
        <p className="rounded-2xl bg-surface px-4 py-3 text-sm/[140%] text-nav-muted">
          &ldquo;{cleanHint}&rdquo;
        </p>
      )}

      <div className="flex flex-col gap-y-3">
        <LocationRow drop={drop} isPrivate={false} />
        {drop.claimedAt > 0 && (
          <p className="flex items-center gap-2 text-sm/none text-nav-muted">
            <Clock className="w-4 h-4 shrink-0" strokeWidth={2} />
            Claimed {new Date(drop.claimedAt * 1000).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        )}
        <p className="flex items-center gap-2 text-sm/none text-nav-muted min-w-0">
          <Gift className="w-4 h-4 shrink-0" strokeWidth={2} />
          <span className="truncate">Dropped by <UserHandle address={drop.dropper} className="text-heading" /></span>
        </p>
      </div>

      <button type="button" onClick={() => onShare(drop)} className={`${PILL} w-full`}>
        <QrCode className="w-4 h-4" strokeWidth={1.75} /> Share
      </button>
    </article>
  );
}

// ── QR share modal ────────────────────────────────────────────────────────────

export function QRShareModal({ drop, onClose }: { drop: Drop; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { isPrivate } = parseDropHint(drop.hint);
  const base = `${typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz"}/drop/${drop.id}`;
  // For private drops, recover the invite token from localStorage so the QR/link includes ?k=TOKEN
  const privateToken = isPrivate && typeof window !== "undefined"
    ? (localStorage.getItem(`gd:privdrop:${drop.id}`) ?? null)
    : null;
  const url = isPrivate && privateToken ? `${base}?k=${privateToken}` : base;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  function copy() {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Sheet title={isPrivate ? "Invitation link" : "Drop link"} onClose={onClose}>
      <div className="flex flex-col gap-y-6 pt-6">
        <p className="text-sm/none text-nav-muted -mt-2">
          {formatG$(drop.amount)} G$ · Drop #{String(drop.id)}
        </p>

        <div className="flex justify-center">
          <div className="rounded-3xl border border-line p-5 bg-white">
            <QRCodeSVG value={url} size={180} level="M" includeMargin={false} />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          <div
            className="w-full lg:flex-1 min-w-0 h-11 rounded-full border border-line px-5 flex items-center text-sm/none text-nav-muted"
            title={url}
          >
            <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
          </div>
          <button type="button" onClick={copy} className={`${PILL} shrink-0 px-6`}>
            {copied ? <Check className="w-[18px] h-[18px] text-brand" strokeWidth={2} /> : <Copy className="w-[18px] h-[18px]" strokeWidth={1.75} />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        {canShare && (
          <button
            type="button"
            onClick={async () => {
              if ((await shareOrCopy({ title: "GoodDrops", url })) === "copied") {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className="w-full h-14 rounded-full bg-nav-active text-white text-base/none flex items-center justify-center gap-2
              cursor-pointer motion-safe:transition-opacity hover:opacity-90"
          >
            <Share2 className="w-5 h-5" strokeWidth={1.75} /> Share link
          </button>
        )}

        {isPrivate && (
          <p className="text-sm/[140%] text-nav-muted text-center -mt-2">
            This drop is hidden from the map. Only people with this link can find it.
          </p>
        )}
      </div>
    </Sheet>
  );
}
