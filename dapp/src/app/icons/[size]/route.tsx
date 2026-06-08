import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params;
  const sz = size === "512" ? 512 : 192;

  return new ImageResponse(
    (
      <div
        style={{
          width: sz, height: sz,
          background: "#111111",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: sz * 0.22,
        }}
      >
        {/* Lime G$ mark */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: sz * 0.03,
        }}>
          <span style={{
            fontSize: sz * 0.42,
            fontWeight: 900,
            color: "#BFFD00",
            lineHeight: 1,
            display: "flex",
          }}>G$</span>
          <div style={{
            width: sz * 0.5,
            height: sz * 0.06,
            background: "#BFFD00",
            borderRadius: sz * 0.03,
            display: "flex",
          }} />
        </div>
      </div>
    ),
    { width: sz, height: sz }
  );
}
