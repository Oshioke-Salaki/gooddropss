import { ImageResponse } from "next/og";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_SPARK } from "@/lib/brandMark";
import { getRedis } from "@/lib/redis";
import { getEvent } from "@/lib/eventStore";
import { CATEGORY_LABEL, isEventId } from "@/lib/events";

export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
// Per request: it reads the event from Redis (uncacheable), which a timed
// static rebuild can't do. Social sites cache the image on their side anyway.
export const dynamic = "force-dynamic";

const BG = "#F5F5F5", CARD = "#FFFFFF", HEADING = "#121607", MUTED = "#6B6E63", BRAND = "#2727E2", SOFT = "#E9E9FC";

function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <path d={MARK_G_TOP} fill={color} />
      <path d={MARK_G_BOTTOM} fill={color} />
      <path d={MARK_DROP} fill={BRAND_SPARK} />
    </svg>
  );
}

export default async function EventOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let e = null;
  try {
    const redis = getRedis();
    if (redis && isEventId(id)) e = await getEvent(redis, id);
  } catch { /* render the generic card */ }
  const visible = e && (e.status === "approved" || e.status === "cancelled");

  // Times shown in Lagos time: crawlers have no viewer timezone, and the
  // audience is overwhelmingly WAT.
  const when = visible
    ? new Date(e!.startsAt * 1000).toLocaleString("en", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }) + " WAT"
    : "";

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, background: BG, display: "flex", padding: 48, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ flex: 1, background: CARD, borderRadius: 40, padding: 64, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 26, background: BRAND, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Mark size={34} color="#FFFFFF" />
            </div>
            <span style={{ fontSize: 30, color: HEADING }}>GoodDrops</span>
            <span style={{ fontSize: 26, color: MUTED }}>· Events</span>
            {visible && (
              <span style={{ marginLeft: "auto", fontSize: 24, color: e!.status === "cancelled" ? "#FF3B3B" : BRAND, background: e!.status === "cancelled" ? "#FFECEC" : SOFT, padding: "10px 22px", borderRadius: 999 }}>
                {e!.status === "cancelled" ? "Cancelled" : CATEGORY_LABEL[e!.category]}
              </span>
            )}
          </div>

          <div style={{ marginTop: 56, fontSize: visible && e!.title.length > 40 ? 64 : 80, lineHeight: 1.05, color: HEADING, display: "flex", maxWidth: 900 }}>
            {visible ? e!.title : "Events with G$ hidden around them"}
          </div>
          {visible && (
            <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 10, fontSize: 30, color: MUTED }}>
              <span style={{ display: "flex" }}>{when}</span>
              <span style={{ display: "flex" }}>{e!.venueName}</span>
            </div>
          )}

          {visible && (
            <div style={{ position: "absolute", left: 64, bottom: 56, display: "flex", alignItems: "baseline", gap: 14 }}>
              <span style={{ fontSize: 64, color: HEADING }}>{e!.budgetG.toLocaleString("en-US")}</span>
              <span style={{ fontSize: 40, color: BRAND }}>G$</span>
              <span style={{ fontSize: 28, color: MUTED }}>to find</span>
            </div>
          )}
          <div style={{ position: "absolute", right: -60, bottom: -60, width: 340, height: 340, borderRadius: 170, background: SOFT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Mark size={170} color={BRAND} />
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
