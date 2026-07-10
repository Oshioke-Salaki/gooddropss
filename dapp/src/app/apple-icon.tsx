import { ImageResponse } from "next/og";

export const size        = { width: 180, height: 180 };
export const contentType = "image/png";

// GoodDrops "Drop Pin" — pin as a falling coin of G$ (matches /public/logo.svg)
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180, height: 180,
          background: "#111111",
          display: "flex",
          position: "relative",
          borderRadius: 40,
        }}
      >
        <svg width="180" height="180" viewBox="0 0 512 512" style={{ position: "absolute", top: 0, left: 0 }}>
          <ellipse cx="256" cy="446" rx="66" ry="13" fill="#BFFD00" opacity="0.28" />
          <path
            d="M256 415 C 226 372 138 294 138 208 A 118 118 0 1 1 374 208 C 374 294 286 372 256 415 Z"
            fill="#BFFD00"
          />
          <circle cx="256" cy="208" r="86" fill="#111111" />
        </svg>
        {/* G$ coin face — satori can't render svg text, so it's an overlay */}
        <div
          style={{
            position: "absolute",
            top: 51, left: 0,
            width: 180,
            display: "flex",
            justifyContent: "center",
            fontSize: 42,
            fontWeight: 900,
            color: "#BFFD00",
            letterSpacing: -1,
          }}
        >
          G$
        </div>
      </div>
    ),
    { width: 180, height: 180 }
  );
}
