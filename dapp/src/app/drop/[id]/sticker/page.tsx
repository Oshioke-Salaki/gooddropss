"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchDropByDropId } from "@/lib/subgraph";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { formatG$, gpsToDeg, getDropRarity, RARITY, parseDropHint } from "@/lib/utils";
import type { Drop } from "@/types";
import { use } from "react";

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
    <div style={styles.loading}>
      <div style={{ fontSize: 48 }}>📍</div>
      <p style={{ fontWeight: 700, color: "#888", marginTop: 12 }}>Loading…</p>
    </div>
  );

  if (!drop) return (
    <div style={styles.loading}>
      <p style={{ fontWeight: 700 }}>Drop not found</p>
    </div>
  );

  const { hint, chainNextId, isChainLast } = parseDropHint(drop.hint);
  const rarity = getDropRarity(drop.amount);
  const r      = RARITY[rarity];
  const isChain = chainNextId !== null || isChainLast;

  return (
    <>
      {/* Print button — hidden when printing */}
      <div style={styles.printBar}>
        <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
          Print this sticker and attach it anywhere — hunters scan to claim!
        </p>
        <button onClick={() => window.print()} style={styles.printBtn}>
          🖨️ Print Sticker
        </button>
      </div>

      {/* ── Sticker ──────────────────────────────────────────────────────── */}
      <div style={styles.page}>
        <div style={styles.sticker}>
          {/* Left: QR */}
          <div style={styles.qrSide}>
            <QRCodeSVG
              value={pageUrl}
              size={160}
              level="H"
              includeMargin={false}
              style={{ display: "block" }}
            />
          </div>

          {/* Right: Info */}
          <div style={styles.infoSide}>
            {/* Logo */}
            <div style={styles.logo}>
              <span style={styles.logoText}>good</span>
              <span style={styles.logoBadge}>drops.</span>
            </div>

            {/* Headline */}
            <p style={styles.headline}>
              {isChain ? "🔗 Hunt Chain" : "💰 Hidden G$ inside!"}
            </p>

            {/* Amount */}
            <div style={styles.amountRow}>
              <span style={{ ...styles.amountNum, color: r.color === "#BFFD00" ? "#111" : r.color }}>
                {formatG$(drop.amount)}
              </span>
              <span style={styles.amountUnit}>G$</span>
              <span style={{ ...styles.rarityBadge, background: r.color, color: r.textColor }}>
                {r.label}
              </span>
            </div>

            {/* Clue */}
            {hint && (
              <div style={styles.clueBox}>
                <p style={styles.clueLabel}>🔍 Clue</p>
                <p style={styles.clueText}>&ldquo;{hint}&rdquo;</p>
              </div>
            )}

            {/* CTA */}
            <p style={styles.cta}>Scan to claim at gooddrops.xyz</p>
          </div>
        </div>

        {/* Instruction below sticker */}
        <p style={styles.instruction} className="no-print">
          Cut along the border and attach anywhere — storefronts, lamp posts, benches.
          Verified GoodDollar users will find and claim it.
        </p>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; background: white; }
          [data-print-bar] { display: none !important; }
        }
        * { box-sizing: border-box; }
      `}</style>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  loading: {
    minHeight: "100vh",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "#f5f4f0",
    fontFamily: "'Space Grotesk', sans-serif",
  },
  printBar: {
    background: "#111", color: "#fff",
    padding: "12px 24px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, flexWrap: "wrap",
    fontFamily: "'Space Grotesk', sans-serif",
  } as React.CSSProperties & { "[data-print-bar]"?: unknown },
  printBtn: {
    background: "#BFFD00", color: "#111",
    border: "none", borderRadius: 8,
    padding: "8px 20px",
    fontWeight: 800, fontSize: 14,
    cursor: "pointer", fontFamily: "inherit",
  },
  page: {
    minHeight: "calc(100vh - 52px)",
    background: "#f5f4f0",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "32px 16px",
    fontFamily: "'Space Grotesk', sans-serif",
  },
  sticker: {
    background: "#fff",
    border: "3px solid #111",
    borderRadius: 20,
    boxShadow: "6px 6px 0 #111",
    padding: 24,
    display: "flex",
    alignItems: "stretch",
    gap: 24,
    maxWidth: 520,
    width: "100%",
  },
  qrSide: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    background: "#fff",
    border: "2px solid #111",
    borderRadius: 12,
    flexShrink: 0,
  },
  infoSide: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    justifyContent: "center",
  },
  logo: {
    display: "flex", alignItems: "center", gap: 4,
  },
  logoText: {
    fontWeight: 900, fontSize: 16, color: "#111",
  },
  logoBadge: {
    background: "#111", color: "#BFFD00",
    fontWeight: 900, fontSize: 14,
    padding: "1px 6px",
  },
  headline: {
    margin: 0,
    fontWeight: 900, fontSize: 22,
    color: "#111", lineHeight: 1.2,
  },
  amountRow: {
    display: "flex", alignItems: "baseline", gap: 6,
  },
  amountNum: {
    fontWeight: 900, fontSize: 42, lineHeight: 1,
  },
  amountUnit: {
    fontWeight: 900, fontSize: 22, color: "#111",
  },
  rarityBadge: {
    borderRadius: 100,
    padding: "3px 10px",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    border: "1.5px solid rgba(0,0,0,0.2)",
  },
  clueBox: {
    borderLeft: "3px solid #BFFD00",
    paddingLeft: 10,
  },
  clueLabel: {
    margin: "0 0 3px",
    fontSize: 10, fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "#888",
  },
  clueText: {
    margin: 0,
    fontSize: 13, fontWeight: 600,
    color: "#333", lineHeight: 1.4,
    fontStyle: "italic",
  },
  cta: {
    margin: 0,
    fontSize: 12, fontWeight: 700,
    color: "#888",
  },
  instruction: {
    marginTop: 20,
    maxWidth: 480,
    textAlign: "center" as const,
    fontSize: 13, color: "#888",
    lineHeight: 1.6,
    fontFamily: "'Space Grotesk', sans-serif",
  },
};
