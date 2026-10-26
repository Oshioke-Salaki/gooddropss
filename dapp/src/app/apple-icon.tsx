import { ImageResponse } from "next/og";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_BLUE, BRAND_SPARK } from "@/lib/brandMark";

export const size        = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon: the G-drop mark on the brand blue tile.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180, height: 180,
          background: BRAND_BLUE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 40,
        }}
      >
        <svg width={124} height={124} viewBox="0 0 512 512">
          <path d={MARK_G_TOP} fill="#FFFFFF" />
          <path d={MARK_G_BOTTOM} fill="#FFFFFF" />
          <path d={MARK_DROP} fill={BRAND_SPARK} />
        </svg>
      </div>
    ),
    { width: 180, height: 180 }
  );
}
