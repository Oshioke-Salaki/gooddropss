"use client";
import { useEffect, useState, use } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, Link2, Search, QrCode } from "lucide-react";
import { fetchDropByDropId } from "@/lib/subgraph";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { formatG$, getDropRarity, RARITY, parseDropHint } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import type { Drop } from "@/types";

/**
 * Printable sticker for a drop. The sticker itself is plain white with a hairline
 * border so it prints cleanly on any printer; the action bar above it is screen-only.
 */
export default function StickerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [drop, setDrop] = useState<Drop | null | undefined>(undefined);

  useEffect(() => {
    async function load() {
      const fromGraph = await fetchDropByDropId(id);
      if (fromGraph) { setDrop(fromGraph); return; }
      try {
        const raw = await publicClient.readContract({
          address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI,
          functionName: "getDrop", args: [BigInt(id)],
        });
        setDrop({
          id: BigInt(id),
          dropper:   raw.dropper,
          amount:    BigInt(raw.amount),
          claimer:   raw.claimer,
          expiry:    Number(raw.expiry),
          claimedAt: Number(raw.claimedAt),
          createdAt: 0,
          status:    Number(raw.status),
          lat:       Number(raw.lat),
          lng:       Number(raw.lng),
          hint:      raw.hint,
        });
      } catch { setDrop(null); }
    }
    load();
  }, [id]);

  const pageUrl = `https://gooddrops.xyz/drop/${id}`;

  if (drop === undefined) return (
    <div className="min-h-screen bg-surface font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-[520px] bg-white rounded-3xl p-6 flex flex-wrap justify-center gap-6">
        <Skeleton className="w-[176px] h-[176px] rounded-2xl" />
        <div className="flex-1 min-w-[200px] flex flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );

  if (!drop) return (
    <div className="min-h-screen bg-surface font-sans flex items-center justify-center p-4">
      <p className="text-base/none text-heading">Drop not found</p>
    </div>
  );

  const { hint, chainNextId, isChainLast } = parseDropHint(drop.hint);
  const rarity = getDropRarity(drop.amount);
  const r      = RARITY[rarity];
  const isChain = chainNextId !== null || isChainLast;

  return (
    <div className="min-h-screen bg-surface font-sans">
      {/* Action bar — screen only */}
      <div className="no-print bg-white border-b border-line px-4 lg:px-15 py-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm/[140%] text-nav-muted">
          Print this sticker and attach it anywhere — hunters scan to claim.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="h-11 px-5 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer
            motion-safe:transition-colors hover:bg-brand/90"
        >
          <Printer className="w-4 h-4" strokeWidth={2} />
          Print sticker
        </button>
      </div>

      {/* ── Sticker ──────────────────────────────────────────────────────── */}
      <div className="print-page flex flex-col items-center justify-center px-4 py-8 min-h-[calc(100vh-73px)]">
        <div
          className="sticker w-full max-w-[520px] bg-white rounded-3xl border border-line p-6
            flex flex-wrap justify-center items-stretch gap-6
            shadow-[0px_0px_12px_0px_#0000000A] print:shadow-none"
        >
          {/* QR */}
          <div className="shrink-0 rounded-2xl border border-line p-2 bg-white flex items-center justify-center">
            <QRCodeSVG value={pageUrl} size={160} level="H" includeMargin={false} style={{ display: "block" }} />
          </div>

          {/* Info — wraps under the QR on narrow phones so the page never scrolls sideways */}
          <div className="flex-[1_1_200px] min-w-0 flex flex-col justify-center gap-3">
            <Logo size="sm" />

            <p className="flex items-center gap-2 text-lg/none text-heading">
              {isChain ? <Link2 className="w-5 h-5 text-brand" strokeWidth={2} /> : <QrCode className="w-5 h-5 text-brand" strokeWidth={2} />}
              {isChain ? "Hunt Chain" : "Hidden G$ inside"}
            </p>

            <div className="flex items-baseline gap-x-2 flex-wrap">
              <span className="font-anta text-[40px]/none text-brand">{formatG$(drop.amount)}</span>
              <span className="text-lg/none text-heading">G$</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 h-6 text-[11px]/none text-heading ml-1">
                <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                {r.label}
              </span>
            </div>

            {hint && (
              <div className="border-l-2 border-brand pl-3">
                <p className="flex items-center gap-1.5 text-[11px]/none text-nav-muted uppercase tracking-wider">
                  <Search className="w-3 h-3" strokeWidth={2} /> Clue
                </p>
                <p className="text-sm/[140%] text-heading italic mt-1.5 break-words">&ldquo;{hint}&rdquo;</p>
              </div>
            )}

            <p className="text-xs/none text-nav-muted">Scan to claim at gooddrops.xyz</p>
          </div>
        </div>

        <p className="no-print mt-5 max-w-[480px] text-center text-sm/[160%] text-nav-muted">
          Cut along the border and attach anywhere — storefronts, lamp posts, benches.
          Verified GoodDollar users will find and claim it.
        </p>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; background: white; }
          .print-page { min-height: 0; padding: 0; }
          .sticker { border-color: #121607; }
        }
      `}</style>
    </div>
  );
}
