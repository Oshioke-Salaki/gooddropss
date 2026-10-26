import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_BLUE, BRAND_SPARK } from "@/lib/brandMark";

export const runtime = "edge";

// PWA icons: the G-drop mark on the brand blue tile. Also served as the
// maskable icon, so the mark stays well inside the safe zone (~62%).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params;
  const sz = size === "512" ? 512 : 192;
  const inner = Math.round(sz * 0.62);

  return new ImageResponse(
    (
      <div
        style={{
          width: sz, height: sz,
          background: BRAND_BLUE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: sz * 0.22,
        }}
      >
        <svg width={inner} height={inner} viewBox="0 0 512 512">
          <path d={MARK_G_TOP} fill="#FFFFFF" />
          <path d={MARK_G_BOTTOM} fill="#FFFFFF" />
          <path d={MARK_DROP} fill={BRAND_SPARK} />
        </svg>
      </div>
    ),
    { width: sz, height: sz }
  );
}
