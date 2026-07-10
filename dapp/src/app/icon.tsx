import { ImageResponse } from "next/og";

export const size        = { width: 32, height: 32 };
export const contentType = "image/png";

// GoodDrops "Drop Pin" mark — favicon (too small for the G$ face, pin only)
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32, height: 32,
          background: "#111111",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 512 512">
          <path
            d="M256 430 C 224 384 128 298 128 202 A 128 128 0 1 1 384 202 C 384 298 288 384 256 430 Z"
            fill="#BFFD00"
          />
          <circle cx="256" cy="202" r="62" fill="#111111" />
        </svg>
      </div>
    ),
    { width: 32, height: 32 }
  );
}
