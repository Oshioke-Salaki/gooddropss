"use client";
import { useEffect, useState, use } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Store, Gift, MapPin, Camera, Printer, Share2, Link as LinkIcon, Check,
  UtensilsCrossed, ShoppingBag, Wrench, Bus, type LucideIcon,
} from "lucide-react";
import type { Spot } from "@/types";

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
    try {
      if (navigator.share) {
        await navigator.share({ title: spot?.name ?? "Pay with G$", text: `Pay ${spot?.name ?? "this shop"} with G$`, url: payUrl });
        return;
      }
    } catch { /* user dismissed — fall through to copy */ }
    copy();
  }
  function copy() {
    navigator.clipboard?.writeText(payUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }

  if (spot === undefined) return (
    <div style={styles.loading}><Store size={48} color="#888" /><p style={{ fontWeight: 700, color: "#888", marginTop: 12 }}>Loading…</p></div>
  );
  if (!spot) return (
    <div style={styles.loading}><p style={{ fontWeight: 700 }}>Shop not found</p></div>
  );

  return (
    <>
      {/* Action bar — hidden when printing */}
      <div style={styles.printBar} className="no-print">
        <p style={{ margin: 0, fontSize: 13, color: "#ccc" }}>Print it for your counter, or share the link.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={share} style={styles.barBtn}><Share2 size={15} /> Share</button>
          <button onClick={copy} style={styles.barBtnAlt}>{copied ? <><Check size={15} /> Copied</> : <><LinkIcon size={15} /> Copy link</>}</button>
          <button onClick={() => window.print()} style={styles.barBtn}><Printer size={15} /> Print</button>
        </div>
      </div>

      {/* ── Poster ─────────────────────────────────────────────────────────── */}
      <div style={styles.page}>
        <div style={styles.poster}>
          <div style={styles.logo}>
            <span style={styles.logoText}>good</span>
            <span style={styles.logoBadge}>drops.</span>
          </div>

          <p style={styles.kicker}>
            {(() => { const I = CATEGORY_ICON[spot.category] ?? Store; return <I size={16} />; })()} {spot.name}
          </p>
          <h1 style={styles.headline}>PAY WITH G$ HERE</h1>

          <div style={styles.qrWrap}>
            <QRCodeSVG value={payUrl} size={230} level="H" includeMargin={false} style={{ display: "block" }} />
          </div>

          <p style={styles.scan}><Camera size={16} /> Scan to pay in seconds</p>

          {spot.discount && (
            <div style={styles.offer}><Gift size={14} /> {spot.discount}</div>
          )}
          {spot.placeName && <p style={styles.place}><MapPin size={13} /> {spot.placeName}</p>}

          <div style={styles.steps}>
            <span>1 · Open camera</span><span>›</span><span>2 · Scan code</span><span>›</span><span>3 · Pay in G$</span>
          </div>
          <p style={styles.foot}>gooddrops.xyz · real, spendable GoodDollar</p>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; background: white; }
        }
        * { box-sizing: border-box; }
      `}</style>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  loading: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" },
  printBar: { background: "#111", color: "#fff", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontFamily: "'Space Grotesk', sans-serif" },
  barBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#BFFD00", color: "#111", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  barBtnAlt: { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#111", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  page: { minHeight: "calc(100vh - 52px)", background: "#f5f4f0", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", fontFamily: "'Space Grotesk', sans-serif" },
  poster: { background: "#fff", border: "3px solid #111", borderRadius: 24, boxShadow: "8px 8px 0 #111", padding: "32px 28px", maxWidth: 420, width: "100%", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  logo: { display: "flex", alignItems: "center", gap: 4, marginBottom: 4 },
  logoText: { fontWeight: 900, fontSize: 18, color: "#111" },
  logoBadge: { background: "#111", color: "#BFFD00", fontWeight: 900, fontSize: 16, padding: "1px 7px" },
  kicker: { display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: 15, fontWeight: 800, color: "#555" },
  headline: { margin: "2px 0 6px", fontSize: 34, fontWeight: 900, color: "#111", letterSpacing: "-0.02em", lineHeight: 1.05 },
  qrWrap: { background: "#fff", border: "3px solid #111", borderRadius: 16, padding: 14, boxShadow: "4px 4px 0 #BFFD00" },
  scan: { display: "flex", alignItems: "center", gap: 6, margin: "6px 0 0", fontSize: 15, fontWeight: 800, color: "#111" },
  offer: { display: "inline-flex", alignItems: "center", gap: 6, background: "#BFFD00", border: "2px solid #111", borderRadius: 100, padding: "5px 14px", fontSize: 14, fontWeight: 900, color: "#111" },
  place: { display: "flex", alignItems: "center", gap: 5, margin: 0, fontSize: 13, fontWeight: 700, color: "#888" },
  steps: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, fontSize: 12, fontWeight: 800, color: "#666", marginTop: 4 },
  foot: { margin: "6px 0 0", fontSize: 11, fontWeight: 700, color: "#aaa" },
};
