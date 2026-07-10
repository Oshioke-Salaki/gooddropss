import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

// GoodDrops "Drop Pin" PWA icons — pin as a falling coin of G$
// (matches /public/logo.svg and the apple/favicon marks)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params;
  const sz = size === "512" ? 512 : 192;

  // The pin head circle sits at y = 208/512 of the canvas; the G$ overlay is
  // centred on it. Font scales with the canvas.
  const fontSize = Math.round(sz * 0.235);
  const textTop  = Math.round(sz * (208 / 512)) - Math.round(fontSize * 0.62);

  return new ImageResponse(
    (
      <div
        style={{
          width: sz, height: sz,
          background: "#111111",
          display: "flex",
          position: "relative",
          borderRadius: sz * 0.22,
        }}
      >
        <svg width={sz} height={sz} viewBox="0 0 512 512" style={{ position: "absolute", top: 0, left: 0 }}>
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
            top: textTop, left: 0,
            width: sz,
            display: "flex",
            justifyContent: "center",
            fontSize,
            fontWeight: 900,
            color: "#BFFD00",
            letterSpacing: -1,
          }}
        >
          G$
        </div>
      </div>
    ),
    { width: sz, height: sz }
  );
}
