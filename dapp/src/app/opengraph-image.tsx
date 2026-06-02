import { ImageResponse } from "next/og";

export const alt         = "GoodDrops — Hide G$ at real-world locations";
export const size        = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200, height: 630,
          background: "#111111",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "72px 80px",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background decorative circles */}
        <div style={{
          position: "absolute", right: -60, top: -60,
          width: 420, height: 420,
          borderRadius: "50%",
          background: "#BFFD00",
          opacity: 0.08,
          display: "flex",
        }} />
        <div style={{
          position: "absolute", right: 160, bottom: -80,
          width: 280, height: 280,
          borderRadius: "50%",
          background: "#BFFD00",
          opacity: 0.06,
          display: "flex",
        }} />

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 40 }}>
          <div style={{
            width: 52, height: 52,
            background: "#BFFD00",
            borderRadius: 12,
            border: "2px solid #BFFD00",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}>💰</div>
          <span style={{ color: "#888888", fontSize: 22, fontWeight: 600, letterSpacing: "0.02em" }}>
            gooddrops.
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <span style={{
            fontSize: 88,
            fontWeight: 900,
            color: "#BFFD00",
            letterSpacing: "-0.04em",
            lineHeight: 0.95,
            display: "flex",
          }}>
            Hide money.
          </span>
          <span style={{
            fontSize: 88,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "-0.04em",
            lineHeight: 0.95,
            display: "flex",
          }}>
            Find money.
          </span>
        </div>

        {/* Tagline */}
        <div style={{
          marginTop: 36,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <div style={{
            background: "#BFFD00",
            color: "#111111",
            padding: "8px 18px",
            borderRadius: 100,
            fontSize: 20,
            fontWeight: 800,
            display: "flex",
          }}>
            G$ locked on-chain
          </div>
          <div style={{
            background: "transparent",
            color: "#888888",
            fontSize: 20,
            fontWeight: 600,
            display: "flex",
          }}>
            Real-world GPS · Celo network
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
