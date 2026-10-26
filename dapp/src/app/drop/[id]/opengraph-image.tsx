import { ImageResponse } from "next/og";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_SPARK } from "@/lib/brandMark";
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

// The GoodDrops G-drop mark (shared geometry with the app and icons). The drop
// keeps its orange whatever colour the G is drawn in.
function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <path d={MARK_G_TOP} fill={color} />
      <path d={MARK_G_BOTTOM} fill={color} />
      <path d={MARK_DROP} fill={BRAND_SPARK} />
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
