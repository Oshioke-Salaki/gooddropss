import { ImageResponse } from "next/og";

export const size        = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32, height: 32,
          background: "#BFFD00",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          border: "1.5px solid #111111",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1, display: "flex" }}>💰</span>
      </div>
    ),
    { width: 32, height: 32 }
  );
}
