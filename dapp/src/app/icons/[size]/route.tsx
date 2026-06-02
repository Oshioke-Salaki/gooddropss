import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: sizeStr } = await params;
  const size = Math.min(Math.max(parseInt(sizeStr) || 512, 16), 1024);
  const radius = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.52);

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: "#BFFD00",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
          border: `${Math.max(2, Math.round(size * 0.03))}px solid #111111`,
          boxShadow: `${Math.round(size * 0.04)}px ${Math.round(size * 0.04)}px 0 #111111`,
        }}
      >
        <span style={{ fontSize, lineHeight: 1, display: "flex" }}>💰</span>
      </div>
    ),
    { width: size, height: size }
  );
}
