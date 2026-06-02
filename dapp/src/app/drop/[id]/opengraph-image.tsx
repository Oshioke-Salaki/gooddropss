import { ImageResponse } from "next/og";
import { fetchDropById } from "@/lib/subgraph";
import { formatG$ } from "@/lib/utils";
import { DROP_STATUS } from "@/types";

export const contentType = "image/png";
export const size        = { width: 1200, height: 630 };

export default async function DropOgImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const drop = await fetchDropById(id);

  // Fallback if drop not found
  if (!drop) {
    return new ImageResponse(
      (
        <div style={{
          width: 1200, height: 630,
          background: "#111111",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}>
          <span style={{ color: "#888888", fontSize: 32, display: "flex" }}>Drop not found</span>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const now      = Math.floor(Date.now() / 1000);
  const isActive = drop.status === DROP_STATUS.Active && drop.expiry > now;
  const isClaimed = drop.status === DROP_STATUS.Claimed;
  const amount   = formatG$(drop.amount);

  const statusLabel = isClaimed ? "CLAIMED" : isActive ? "LIVE" : "EXPIRED";
  const statusBg    = isActive ? "#BFFD00" : "#444444";
  const statusColor = isActive ? "#111111" : "#ffffff";

  const hint = drop.hint
    ? drop.hint.length > 80
      ? drop.hint.slice(0, 80) + "…"
      : drop.hint
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200, height: 630,
          background: "#111111",
          display: "flex",
          flexDirection: "column",
          padding: "60px 72px",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background glow */}
        <div style={{
          position: "absolute", right: -100, top: -100,
          width: 500, height: 500,
          borderRadius: "50%",
          background: isActive ? "#BFFD00" : "#444444",
          opacity: 0.07,
          display: "flex",
        }} />

        {/* Top row: logo + status */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44,
              background: "#BFFD00",
              borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24,
            }}>💰</div>
            <span style={{ color: "#888888", fontSize: 20, fontWeight: 600, display: "flex" }}>
              gooddrops. · Drop #{id}
            </span>
          </div>
          <div style={{
            background: statusBg,
            color: statusColor,
            padding: "6px 16px",
            borderRadius: 100,
            fontSize: 16,
            fontWeight: 900,
            letterSpacing: "0.08em",
            display: "flex",
          }}>
            {statusLabel}
          </div>
        </div>

        {/* Amount */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: hint ? 32 : 0 }}>
          <span style={{
            fontSize: 120,
            fontWeight: 900,
            color: "#BFFD00",
            letterSpacing: "-0.04em",
            lineHeight: 0.9,
            display: "flex",
          }}>
            {amount}
          </span>
          <span style={{
            fontSize: 52,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.02em",
            display: "flex",
          }}>
            G$
          </span>
          <span style={{
            fontSize: 28,
            color: "#888888",
            fontWeight: 600,
            alignSelf: "flex-end",
            marginBottom: 12,
            display: "flex",
          }}>
            hidden somewhere
          </span>
        </div>

        {/* Hint */}
        {hint && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            background: "#1e1e1e",
            border: "2px dashed #444444",
            borderRadius: 16,
            padding: "18px 22px",
            marginTop: 8,
          }}>
            <span style={{ fontSize: 24, display: "flex", flexShrink: 0 }}>🔍</span>
            <span style={{ color: "#cccccc", fontSize: 26, fontWeight: 500, lineHeight: 1.3, display: "flex", flexWrap: "wrap" }}>
              {hint}
            </span>
          </div>
        )}

        {/* Bottom tagline */}
        <div style={{
          position: "absolute",
          bottom: 48,
          left: 72,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ color: "#555555", fontSize: 18, fontWeight: 600, display: "flex" }}>
            Get within 100m to claim · Verified accounts only
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
