import { ImageResponse } from "next/og";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_BLUE, BRAND_SPARK } from "@/lib/brandMark";

export const size        = { width: 32, height: 32 };
export const contentType = "image/png";

// Favicon: the G-drop mark on the brand blue tile. Drawn a little larger than
// the app icon's mark, since at 32px every pixel of the G counts.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32, height: 32,
          background: BRAND_BLUE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
        }}
      >
        <svg width={28} height={28} viewBox="0 0 512 512">
          <path d={MARK_G_TOP} fill="#FFFFFF" />
          <path d={MARK_G_BOTTOM} fill="#FFFFFF" />
          <path d={MARK_DROP} fill={BRAND_SPARK} />
        </svg>
      </div>
    ),
    { width: 32, height: 32 }
  );
}
