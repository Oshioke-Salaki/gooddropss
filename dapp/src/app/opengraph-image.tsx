import { ImageResponse } from "next/og";

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

// The GoodDrops bag mark (same path as public/logo-mark-white.svg).
const BAG_PATH =
  "M16.4268 7.9482C16.0831 7.89997 15.732 7.875 15.375 7.875C12.9303 7.875 10.7591 9.0453 9.3909 10.8532C9.26258 10.8665 9.13223 10.8734 9 10.8734C8.0391 10.8734 7.16413 10.5129 6.50018 9.9186L5.49982 11.0363C6.31403 11.7651 7.35856 12.244 8.50995 12.3507C8.10172 13.2762 7.875 14.2997 7.875 15.375C7.875 15.732 7.89997 16.0831 7.9482 16.4268C4.30402 15.9154 1.5 12.7852 1.5 9C1.5 4.85786 4.85786 1.5 9 1.5C12.7852 1.5 15.9154 4.30402 16.4268 7.9482ZM16.403 9.46275C16.0691 9.40507 15.7255 9.375 15.375 9.375C13.3242 9.375 11.5134 10.4032 10.4301 11.9756C9.76455 12.9417 9.375 14.1117 9.375 15.375C9.375 15.7255 9.40507 16.0691 9.46275 16.403L16.403 9.46275ZM6.375 8.625C6.99632 8.625 7.5 8.1213 7.5 7.5C7.5 6.87868 6.99632 6.375 6.375 6.375C5.75368 6.375 5.25 6.87868 5.25 7.5C5.25 8.1213 5.75368 8.625 6.375 8.625ZM11.625 8.625C12.2463 8.625 12.75 8.1213 12.75 7.5C12.75 6.87868 12.2463 6.375 11.625 6.375C11.0037 6.375 10.5 6.87868 10.5 7.5C10.5 8.1213 11.0037 8.625 11.625 8.625Z";

function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d={BAG_PATH} fill={color} fillRule="evenodd" clipRule="evenodd" />
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
