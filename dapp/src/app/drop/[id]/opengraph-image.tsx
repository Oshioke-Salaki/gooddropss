import { ImageResponse } from "next/og";
import { fetchDropById } from "@/lib/subgraph";
import { formatG$, parseDropHint, getDropRarity, RARITY } from "@/lib/utils";
import { DROP_STATUS } from "@/types";

export const contentType = "image/png";
export const size        = { width: 1200, height: 630 };
// A drop's preview (amount, rarity, clue) is fixed at creation, so cache the
// rendered PNG for an hour. Image generation (satori/resvg) is CPU-heavy, and
// social crawlers re-fetch link previews often — this stops needless re-renders.
export const revalidate  = 3600;

// Brand tokens (mirrors globals.css — the edge runtime can't read the stylesheet).
const BG      = "#F5F5F5";
const CARD    = "#FFFFFF";
const HEADING = "#121607";
const MUTED   = "#6B6E63";
const LINE    = "#F0F0F0";
const BRAND   = "#2727E2";
const SOFT    = "#E9E9FC";

// The GoodDrops bag mark (same path as public/logo-mark-white.svg).
const BAG_PATH =
  "M16.4268 7.9482C16.0831 7.89997 15.732 7.875 15.375 7.875C12.9303 7.875 10.7591 9.0453 9.3909 10.8532C9.26258 10.8665 9.13223 10.8734 9 10.8734C8.0391 10.8734 7.16413 10.5129 6.50018 9.9186L5.49982 11.0363C6.31403 11.7651 7.35856 12.244 8.50995 12.3507C8.10172 13.2762 7.875 14.2997 7.875 15.375C7.875 15.732 7.89997 16.0831 7.9482 16.4268C4.30402 15.9154 1.5 12.7852 1.5 9C1.5 4.85786 4.85786 1.5 9 1.5C12.7852 1.5 15.9154 4.30402 16.4268 7.9482ZM16.403 9.46275C16.0691 9.40507 15.7255 9.375 15.375 9.375C13.3242 9.375 11.5134 10.4032 10.4301 11.9756C9.76455 12.9417 9.375 14.1117 9.375 15.375C9.375 15.7255 9.40507 16.0691 9.46275 16.403L16.403 9.46275ZM6.375 8.625C6.99632 8.625 7.5 8.1213 7.5 7.5C7.5 6.87868 6.99632 6.375 6.375 6.375C5.75368 6.375 5.25 6.87868 5.25 7.5C5.25 8.1213 5.75368 8.625 6.375 8.625ZM11.625 8.625C12.2463 8.625 12.75 8.1213 12.75 7.5C12.75 6.87868 12.2463 6.375 11.625 6.375C11.0037 6.375 10.5 6.87868 10.5 7.5C10.5 8.1213 11.0037 8.625 11.625 8.625Z";

function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path d={BAG_PATH} fill={color} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

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
          background: BG,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}>
          <span style={{ color: MUTED, fontSize: 32, display: "flex" }}>Drop not found</span>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const now      = Math.floor(Date.now() / 1000);
  const isActive = drop.status === DROP_STATUS.Active && drop.expiry > now;
  const isClaimed = drop.status === DROP_STATUS.Claimed;
  const amount   = formatG$(drop.amount);

  const statusLabel = isClaimed ? "Claimed" : isActive ? "Live" : "Expired";
  const statusBg    = isActive ? BRAND : "#ECECEC";
  const statusColor = isActive ? "#FFFFFF" : HEADING;

  const rawHint = parseDropHint(drop.hint).hint;
  const hint = rawHint ? (rawHint.length > 80 ? rawHint.slice(0, 80) + "…" : rawHint) : null;

  const rarity = getDropRarity(drop.amount);
  const r = RARITY[rarity];

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200, height: 630,
          background: BG,
          display: "flex",
          padding: 48,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* The card */}
        <div
          style={{
            flex: 1,
            background: CARD,
            borderRadius: 40,
            padding: "56px 64px",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Soft brand disc, bottom right */}
          <div style={{
            position: "absolute", right: -120, bottom: -160,
            width: 460, height: 460, borderRadius: 230,
            background: SOFT, display: "flex",
          }} />
          <div style={{ position: "absolute", right: 56, bottom: 36, display: "flex", opacity: 0.9 }}>
            <Mark size={150} color={BRAND} />
          </div>

          {/* Top row: logo + status */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 24, background: BRAND,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Mark size={24} color="#FFFFFF" />
              </div>
              <span style={{ color: HEADING, fontSize: 26, fontWeight: 600, display: "flex" }}>GoodDrops</span>
              <span style={{ color: MUTED, fontSize: 22, display: "flex" }}>· Drop #{id}</span>
            </div>
            <div style={{
              background: statusBg, color: statusColor,
              padding: "12px 22px", borderRadius: 100,
              fontSize: 20, fontWeight: 600, display: "flex",
            }}>
              {statusLabel}
            </div>
          </div>

          {/* Amount */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 18, marginTop: 64 }}>
            <span style={{
              fontSize: 136, fontWeight: 700, color: HEADING,
              letterSpacing: "-0.04em", lineHeight: 0.85, display: "flex",
            }}>
              {amount}
            </span>
            <span style={{ fontSize: 48, fontWeight: 500, color: MUTED, display: "flex", paddingBottom: 8 }}>
              G$
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 28 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              border: `2px solid ${LINE}`, borderRadius: 100, padding: "10px 18px",
              color: HEADING, fontSize: 20,
            }}>
              <div style={{ width: 14, height: 14, borderRadius: 7, background: r.color, display: "flex" }} />
              {r.label}
            </div>
            <span style={{ color: MUTED, fontSize: 22, display: "flex" }}>hidden at a real place</span>
          </div>

          {/* Hint */}
          {hint && (
            <div style={{
              display: "flex", alignItems: "center", gap: 16,
              marginTop: 28, maxWidth: 820,
            }}>
              <div style={{ width: 6, height: 56, borderRadius: 3, background: BRAND, display: "flex", flexShrink: 0 }} />
              <span style={{ color: HEADING, fontSize: 30, fontWeight: 500, lineHeight: 1.3, display: "flex" }}>
                {hint}
              </span>
            </div>
          )}

          {/* Bottom tagline — in flow, pinned to the bottom of the card */}
          <div style={{ marginTop: "auto", display: "flex" }}>
            <span style={{ color: MUTED, fontSize: 20, display: "flex" }}>
              Get within 100m to claim · Verified humans only · gooddrops.xyz
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
