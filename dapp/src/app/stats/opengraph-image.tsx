import { ImageResponse } from "next/og";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_SPARK } from "@/lib/brandMark";
import { getPublicStats } from "./data";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "GoodDrops in numbers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#F5F5F5", CARD = "#FFFFFF", HEADING = "#121607", MUTED = "#6B6E63", BRAND = "#2727E2", SOFT = "#E9E9FC";
const fmt = (n: number) => n.toLocaleString("en");
const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmt(n);

function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <path d={MARK_G_TOP} fill={color} />
      <path d={MARK_G_BOTTOM} fill={color} />
      <path d={MARK_DROP} fill={BRAND_SPARK} />
    </svg>
  );
}

/** Link preview for /stats: the live headline numbers in the brand card. */
export default async function StatsOg() {
  const s = await getPublicStats().catch(() => null);
  const tiles: [string, string][] = s
    ? [[fmt(s.drops), "drops hidden"], [fmt(s.claims), "claimed"], [fmt(s.hunters), "hunters"]]
    : [];
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, background: BG, display: "flex", padding: 48, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ flex: 1, background: CARD, borderRadius: 40, padding: "52px 60px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -160, top: -160, width: 520, height: 520, borderRadius: 260, background: SOFT, display: "flex" }} />
          <div style={{ position: "absolute", right: 64, top: 56, display: "flex" }}><Mark size={150} color={BRAND} /></div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 22, background: BRAND, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Mark size={22} color="#FFFFFF" />
            </div>
            <span style={{ color: HEADING, fontSize: 26, fontWeight: 600, display: "flex" }}>GoodDrops in numbers</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
            <span style={{ fontSize: 108, fontWeight: 700, color: BRAND, letterSpacing: "-0.04em", lineHeight: 1, display: "flex" }}>
              {s ? `${compact(s.claimedG)} G$` : "Real G$"}
            </span>
            <span style={{ fontSize: 30, color: MUTED, marginTop: 14, display: "flex" }}>
              {s ? "found at real places by face-verified people" : "hidden at real places, found by real people"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: "auto" }}>
            {tiles.map(([v, l]) => (
              <div key={l} style={{ display: "flex", alignItems: "baseline", gap: 10, background: BG, borderRadius: 999, padding: "16px 26px" }}>
                <span style={{ fontSize: 34, fontWeight: 700, color: HEADING, display: "flex" }}>{v}</span>
                <span style={{ fontSize: 24, color: MUTED, display: "flex" }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
