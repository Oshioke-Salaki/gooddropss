"use client";
import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { useDrops } from "@/hooks/useDrops";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import {
  formatG$,
  timeLeft,
  gpsToDeg,
  formatDegrees,
  openGoogleMapsWalking,
  parseDropHint,
} from "@/lib/utils";
import { UserHandle } from "@/components/UserHandle";
import { DROP_STATUS, type Drop } from "@/types";
import { QRCodeSVG } from "qrcode.react";
import { QrCode, Copy, Check, Share2, X, Printer } from "lucide-react";
import clsx from "clsx";

const STATUS_LABEL: Record<number, string> = {
  [DROP_STATUS.Active]: "Active",
  [DROP_STATUS.Claimed]: "Claimed",
  [DROP_STATUS.Reclaimed]: "Reclaimed",
};

function DropCard({
  drop,
  onReclaim,
  isReclaiming,
  onShare,
}: {
  drop: Drop;
  onReclaim: (id: bigint) => void;
  isReclaiming: boolean;
  onShare: (drop: Drop) => void;
}) {
  const isExpiredActive =
    drop.status === DROP_STATUS.Active &&
    drop.expiry < Math.floor(Date.now() / 1000);
  const isActive =
    drop.status === DROP_STATUS.Active && !isExpiredActive;
  const { isPrivate, hint: cleanHint, chainNextId, isChainLast } = parseDropHint(drop.hint);
  const isChain = chainNextId !== null || isChainLast;

  return (
    <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-2xl font-black">{formatG$(drop.amount)}</span>
          <span className="text-lime font-black text-lg ml-1">G$</span>
          {isPrivate && !isChain && (
            <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full border border-ink bg-cream text-muted">
              📫 Private
            </span>
          )}
          {isChain && (
            <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full border border-ink bg-ink text-lime">
              🔗 Chain
            </span>
          )}
        </div>
        <span
          className={clsx(
            "text-xs font-bold px-2.5 py-1 rounded-full border-2",
            isActive && "bg-lime border-ink text-ink",
            isExpiredActive && "bg-danger/10 border-danger text-danger",
            drop.status === DROP_STATUS.Claimed &&
              "bg-border border-muted text-muted",
            drop.status === DROP_STATUS.Reclaimed &&
              "bg-border border-muted text-muted"
          )}
        >
          {isExpiredActive ? "Expired" : STATUS_LABEL[drop.status]}
        </span>
      </div>

      {cleanHint && (
        <p className="text-sm text-muted italic border-l-2 border-lime pl-3 leading-relaxed">
          &quot;{cleanHint}&quot;
        </p>
      )}

      <div className="text-xs text-muted space-y-1">
        {/* Private drops store (0,0) on-chain — showing maps would go to the ocean */}
        {isPrivate ? (
          <div className="flex items-center gap-1.5">📍 Location hidden</div>
        ) : (
          <button
            onClick={() => openGoogleMapsWalking(gpsToDeg(drop.lat), gpsToDeg(drop.lng))}
            className="flex items-center gap-1.5 hover:text-ink transition-colors"
          >
            📍 {formatDegrees(drop.lat)} N, {formatDegrees(drop.lng)} E
            <span className="underline font-semibold">Open in Maps ↗</span>
          </button>
        )}
        {isActive && <div>⏰ {timeLeft(drop.expiry)}</div>}
        {drop.status === DROP_STATUS.Claimed && drop.claimer && (
          <div>✓ Claimed by <UserHandle address={drop.claimer} /></div>
        )}
        {isExpiredActive && <div>You can reclaim your G$</div>}
      </div>

      {isExpiredActive && (
        <button
          onClick={() => !isReclaiming && onReclaim(drop.id)}
          disabled={isReclaiming}
          className={clsx(
            "btn-brutal w-full py-2.5 rounded-xl text-sm font-bold transition-all",
            isReclaiming
              ? "bg-border text-muted cursor-not-allowed shadow-none"
              : "bg-lime text-ink"
          )}
          style={isReclaiming ? { boxShadow: "none", transform: "none" } : {}}
        >
          {isReclaiming ? "Reclaiming…" : `Reclaim ${formatG$(drop.amount)} G$`}
        </button>
      )}

      {/* Share / QR + Print sticker buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => onShare(drop)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold border border-ink text-muted hover:bg-lime hover:text-ink hover:border-ink transition-colors"
        >
          <QrCode size={13} />
          Share / QR
        </button>
        <a
          href={`/drop/${drop.id}/sticker`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold border border-ink text-muted hover:bg-ink hover:text-lime hover:border-ink transition-colors"
          style={{ textDecoration: "none" }}
        >
          <Printer size={13} />
          Print Sticker
        </a>
      </div>
    </div>
  );
}

function ClaimCard({ drop, onShare }: { drop: Drop; onShare: (drop: Drop) => void }) {
  const { hint: cleanHint, isChainLast } = parseDropHint(drop.hint);
  return (
    <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-2xl font-black">{formatG$(drop.amount)}</span>
          <span className="text-lime font-black text-lg ml-1">G$</span>
        </div>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full border-2 bg-lime border-ink text-ink">
          {isChainLast ? "🏆 Hunt Complete" : "Claimed 🎯"}
        </span>
      </div>

      {cleanHint && (
        <p className="text-sm text-muted italic border-l-2 border-lime pl-3 leading-relaxed">
          &quot;{cleanHint}&quot;
        </p>
      )}

      <div className="text-xs text-muted space-y-1">
        <button
          onClick={() => openGoogleMapsWalking(gpsToDeg(drop.lat), gpsToDeg(drop.lng))}
          className="flex items-center gap-1.5 hover:text-ink transition-colors"
        >
          📍 {formatDegrees(drop.lat)} N, {formatDegrees(drop.lng)} E
          <span className="underline font-semibold">Open in Maps ↗</span>
        </button>
        {drop.claimedAt > 0 && (
          <div>
            ⏱ Claimed {new Date(drop.claimedAt * 1000).toLocaleDateString()}
          </div>
        )}
        <div>Dropped by <UserHandle address={drop.dropper} /></div>
      </div>

      <button
        onClick={() => onShare(drop)}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold border border-ink text-muted hover:bg-lime hover:text-ink hover:border-ink transition-colors"
      >
        <QrCode size={13} />
        Share / QR
      </button>
    </div>
  );
}

// ── QR share modal ────────────────────────────────────────────────────────────

function QRShareModal({ drop, onClose }: { drop: Drop; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { isPrivate } = parseDropHint(drop.hint);
  const base = `${typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz"}/drop/${drop.id}`;
  // For private drops, recover the invite token from localStorage so the QR/link includes ?k=TOKEN
  const privateToken = isPrivate && typeof window !== "undefined"
    ? (localStorage.getItem(`gd:privdrop:${drop.id}`) ?? null)
    : null;
  const url = isPrivate && privateToken ? `${base}?k=${privateToken}` : base;

  function copy() {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative w-full sm:max-w-sm bg-cream border-t-2 sm:border-2 border-ink rounded-t-3xl sm:rounded-3xl p-6 space-y-5 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle / close */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-black text-lg leading-tight">
              {isPrivate ? "📫 Invitation link" : "🔗 Drop link"}
            </p>
            <p className="text-xs text-muted font-medium mt-0.5">
              {formatG$(drop.amount)} G$ · #{String(drop.id)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full border-2 border-ink text-ink hover:bg-ink hover:text-lime transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* QR code */}
        <div className="flex justify-center">
          <div className="bg-white border-2 border-ink rounded-2xl p-4 shadow-brutal">
            <QRCodeSVG value={url} size={180} level="M" includeMargin={false} />
          </div>
        </div>

        {/* URL + copy */}
        <div className="flex items-center gap-2 bg-card border-2 border-ink rounded-xl px-3 py-2 min-w-0">
          <span className="text-xs font-mono text-muted truncate flex-1 min-w-0">{url}</span>
          <button
            onClick={copy}
            className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-md border-2 border-ink bg-cream hover:bg-lime transition-colors"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Native share */}
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            onClick={() => navigator.share?.({ title: "GoodDrops", url })}
            className="btn-brutal w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-ink text-lime"
          >
            <Share2 size={15} />
            Share link
          </button>
        )}

        {isPrivate && (
          <p className="text-xs text-muted text-center">
            This drop is hidden from the map. Only people with this link can find it.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyDropsPage() {
  const { address, isConnected } = useAccount();
  const { drops, loading, fetchDrops } = useDrops();
  const { writeContractAsync } = useWriteContract();
  const [tab, setTab] = useState<"created" | "claimed">("created");
  const [reclaiming, setReclaiming] = useState<bigint | null>(null);
  const [sharingDrop, setSharingDrop] = useState<Drop | null>(null);

  useEffect(() => {
    fetchDrops();
  }, [fetchDrops]);

  const myCreated = drops.filter(
    (d) => d.dropper.toLowerCase() === address?.toLowerCase()
  );
  const myClaimed = drops.filter(
    (d) =>
      d.claimer.toLowerCase() === address?.toLowerCase() &&
      d.status === DROP_STATUS.Claimed
  );

  async function handleReclaim(dropId: bigint) {
    setReclaiming(dropId);
    try {
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "reclaimExpired",
        args: [dropId],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      fetchDrops();
    } catch (e) {
      console.error(e);
    } finally {
      setReclaiming(null);
    }
  }

  return (
    <div className="min-h-screen bg-cream pb-20">
      <Nav />

      <div className="max-w-screen-md mx-auto px-4 pt-20 pb-8">
        <h1 className="text-3xl font-black tracking-tight mb-1">My Drops</h1>
        <p className="text-muted text-sm mb-6">Your hidden drops and finds</p>

        {!isConnected && (
          <div className="border-2 border-ink rounded-2xl p-8 text-center space-y-3">
            <div className="text-5xl">💳</div>
            <p className="font-bold text-lg">Sign in to continue</p>
            <p className="text-sm text-muted">
              Connect to see your drops and claims.
            </p>
          </div>
        )}

        {isConnected && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-lime border-2 border-ink rounded-2xl p-4 shadow-brutal-sm">
                <div className="text-3xl font-black">{myCreated.length}</div>
                <div className="text-sm font-semibold mt-1">Drops created</div>
              </div>
              <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm">
                <div className="text-3xl font-black">{myClaimed.length}</div>
                <div className="text-sm font-semibold mt-1">Drops claimed</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-2 border-ink rounded-xl overflow-hidden mb-5">
              {(["created", "claimed"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={clsx(
                    "flex-1 py-3 text-sm font-bold capitalize transition-colors",
                    tab === t
                      ? "bg-ink text-lime"
                      : "bg-cream text-muted hover:bg-border"
                  )}
                >
                  {t === "created"
                    ? `Created (${myCreated.length})`
                    : `Claimed (${myClaimed.length})`}
                </button>
              ))}
            </div>

            {/* Content */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-32 bg-border rounded-2xl animate-pulse"
                  />
                ))}
              </div>
            ) : tab === "created" ? (
              myCreated.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <div className="text-5xl">📦</div>
                  <p className="font-bold">No drops yet</p>
                  <p className="text-sm text-muted">
                    Go hide some G$ for the world to find!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myCreated.map((d) => (
                    <DropCard
                      key={String(d.id)}
                      drop={d}
                      onReclaim={handleReclaim}
                      isReclaiming={reclaiming === d.id}
                      onShare={setSharingDrop}
                    />
                  ))}
                </div>
              )
            ) : myClaimed.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <div className="text-5xl">🗺️</div>
                <p className="font-bold">No claims yet</p>
                <p className="text-sm text-muted">
                  Find drops on the map and hunt them down!
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {myClaimed.map((d) => (
                  <ClaimCard key={String(d.id)} drop={d} onShare={setSharingDrop} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />

      {/* QR share modal */}
      {sharingDrop && (
        <QRShareModal drop={sharingDrop} onClose={() => setSharingDrop(null)} />
      )}
    </div>
  );
}
