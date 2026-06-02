import { ImageResponse } from "next/og";

export const size        = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180, height: 180,
          background: "#BFFD00",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 40,
          border: "5px solid #111111",
        }}
      >
        <span style={{ fontSize: 100, lineHeight: 1, display: "flex" }}>💰</span>
      </div>
    ),
    { width: 180, height: 180 }
  );
}
