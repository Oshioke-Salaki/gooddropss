import { ImageResponse } from "next/og";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_SPARK } from "@/lib/brandMark";

export const alt         = "GoodDrops — Hide G$ at real-world locations";
export const size        = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand tokens (mirrors globals.css — the edge runtime can't read the stylesheet).
const BG      = "#F5F5F5";
const CARD    = "#FFFFFF";
const HEADING = "#121607";
const MUTED   = "#6B6E63";
const BRAND   = "#2727E2";
const SOFT    = "#E9E9FC";

// The GoodDrops G-drop mark (shared geometry with the app and icons). The drop
// keeps its orange whatever colour the G is drawn in.
function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <path d={MARK_G_TOP} fill={color} />
      <path d={MARK_G_BOTTOM} fill={color} />
      <path d={MARK_DROP} fill={BRAND_SPARK} />
    </svg>
  );
}

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200, height: 630,
          background: BG,
          display: "flex",
          padding: 48,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            background: CARD,
            borderRadius: 40,
            padding: "56px 64px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{
            position: "absolute", right: -140, top: -140,
            width: 520, height: 520, borderRadius: 260,
            background: SOFT, display: "flex",
          }} />
          <div style={{ position: "absolute", right: 72, top: 64, display: "flex" }}>
            <Mark size={220} color={BRAND} />
          </div>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 48 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 24, background: BRAND,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Mark size={24} color="#FFFFFF" />
            </div>
            <span style={{ color: HEADING, fontSize: 26, fontWeight: 600, display: "flex" }}>GoodDrops</span>
          </div>

          {/* Headline */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{
              fontSize: 96, fontWeight: 700, color: HEADING,
              letterSpacing: "-0.04em", lineHeight: 0.95, display: "flex",
            }}>
              Hide money.
            </span>
            <span style={{
              fontSize: 96, fontWeight: 700, color: BRAND,
              letterSpacing: "-0.04em", lineHeight: 0.95, display: "flex",
            }}>
              Find money.
            </span>
          </div>

          {/* Tagline */}
          <div style={{ marginTop: 44, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              background: BRAND, color: "#FFFFFF",
              padding: "12px 22px", borderRadius: 100,
              fontSize: 22, fontWeight: 600, display: "flex",
            }}>
              Real G$, locked on-chain
            </div>
            <div style={{ color: MUTED, fontSize: 22, display: "flex" }}>
              Real-world GPS · Celo network
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
