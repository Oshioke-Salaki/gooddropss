"use client";
import { useEffect, useState, use } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Store, Gift, MapPin, Camera, Printer, Share2, Link as LinkIcon, Check,
  UtensilsCrossed, ShoppingBag, Wrench, Bus, type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import type { Spot } from "@/types";
import { shareOrCopy } from "@/lib/share";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  food: UtensilsCrossed, retail: ShoppingBag, services: Wrench, transport: Bus, other: Store,
};

// A printable "Pay with G$ here" poster a merchant sticks on the wall/counter.
// Customers scan the QR → the app opens straight to this shop's pay sheet
// (/?spot=<id>), so a walk-in can pay in G$ in seconds.
export default function ShopPosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [spot, setSpot] = useState<Spot | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/spots?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => setSpot(d.spot ?? null))
      .catch(() => setSpot(null));
  }, [id]);

  const payUrl = `https://gooddrops.xyz/?spot=${id}`;

  async function share() {
    const r = await shareOrCopy({ title: spot?.name ?? "Pay with G$", text: `Pay ${spot?.name ?? "this shop"} with G$`, url: payUrl });
    if (r === "copied") { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  }
  function copy() {
    navigator.clipboard?.writeText(payUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }

  if (spot === undefined) return (
    <div className="min-h-screen bg-surface font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-white rounded-3xl p-7 flex flex-col items-center gap-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="w-[262px] h-[262px] rounded-2xl" />
        <Skeleton className="h-4 w-40" />
      </div>
    </div>
  );
  if (!spot) return (
    <div className="min-h-screen bg-surface font-sans flex items-center justify-center p-4">
      <p className="text-base/none text-heading">Shop not found</p>
    </div>
  );

  const CategoryIcon = CATEGORY_ICON[spot.category] ?? Store;
  const BAR_BTN =
    "h-11 px-4 rounded-full text-sm/none flex items-center gap-2 cursor-pointer motion-safe:transition-colors";

  return (
    <div className="min-h-screen bg-surface font-sans">
      {/* Action bar — screen only */}
      <div className="no-print bg-white border-b border-line px-4 lg:px-15 py-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm/[140%] text-nav-muted">Print it for your counter, or share the link.</p>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={share} className={`${BAR_BTN} border border-line bg-white text-heading hover:bg-surface`}>
            <Share2 className="w-4 h-4" strokeWidth={2} /> Share
          </button>
          <button type="button" onClick={copy} className={`${BAR_BTN} border border-line bg-white text-heading hover:bg-surface`}>
            {copied ? <><Check className="w-4 h-4 text-brand" strokeWidth={2} /> Copied</> : <><LinkIcon className="w-4 h-4" strokeWidth={2} /> Copy link</>}
          </button>
          <button type="button" onClick={() => window.print()} className={`${BAR_BTN} bg-brand text-white hover:bg-brand/90`}>
            <Printer className="w-4 h-4" strokeWidth={2} /> Print
          </button>
        </div>
      </div>

      {/* ── Poster ─────────────────────────────────────────────────────────── */}
      <div className="print-page flex items-center justify-center px-4 py-8 min-h-[calc(100vh-73px)]">
        <div
          className="poster w-full max-w-[420px] bg-white rounded-3xl border border-line px-7 py-8
            flex flex-col items-center text-center gap-3 shadow-[0px_0px_12px_0px_#0000000A] print:shadow-none"
        >
          <Logo size="md" />

          <p className="flex items-center gap-2 text-sm/none text-nav-muted mt-1">
            <CategoryIcon className="w-4 h-4" strokeWidth={2} /> {spot.name}
          </p>
          <h1 className="text-[34px]/none text-brand tracking-tight">Pay with G$ here</h1>

          <div className="mt-2 rounded-2xl border border-line p-4 bg-white">
            <QRCodeSVG value={payUrl} size={230} level="H" includeMargin={false} style={{ display: "block" }} />
          </div>

          <p className="flex items-center gap-2 text-base/none text-heading mt-1">
            <Camera className="w-4 h-4" strokeWidth={2} /> Scan to pay in seconds
          </p>

          {spot.discount && (
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft text-brand px-4 h-9 text-sm/none">
              <Gift className="w-4 h-4" strokeWidth={2} /> {spot.discount}
            </span>
          )}
          {spot.placeName && (
            <p className="flex items-center gap-1.5 text-sm/none text-nav-muted">
              <MapPin className="w-3.5 h-3.5" strokeWidth={2} /> {spot.placeName}
            </p>
          )}

          <div className="flex flex-wrap justify-center gap-2 mt-2">
            {["1 · Open camera", "2 · Scan code", "3 · Pay in G$"].map((s) => (
              <span key={s} className="rounded-full bg-surface px-3 h-8 flex items-center text-xs/none text-heading">
                {s}
              </span>
            ))}
          </div>
          <p className="text-xs/none text-nav-muted mt-1">gooddrops.xyz · real, spendable GoodDollar</p>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; background: white; }
          .print-page { min-height: 0; padding: 0; }
          .poster { border-color: #121607; }
        }
      `}</style>
    </div>
  );
}
