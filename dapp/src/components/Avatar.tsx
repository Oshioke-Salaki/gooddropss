// Avatar. Defaults to a deterministic gradient + monogram derived from the
// wallet (no uploads, no storage). If the user has picked a PRESET (a curated
// gradient + glyph vibe), that renders instead — still no hosting/moderation.
// Optional rank RING + status BADGE let status visibly "level up".
import { getAvatarPreset } from "@/lib/avatarPresets";

interface Props {
  address: string;
  username?: string | null;
  size?: number;
  /** ring colour — e.g. a rank/tier colour. Defaults to ink. */
  ringColor?: string;
  /** small emoji shown bottom-right (recruiter tier, top-hunter crown, etc.) */
  badge?: string | null;
  /** chosen preset id — overrides the generated monogram when set + valid. */
  preset?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

function hueAt(hex: string, start: number): number {
  const slice = hex.slice(start, start + 6) || "0";
  return parseInt(slice, 16) % 360 || 0;
}

export function Avatar({ address, username, size = 44, ringColor = "#111", badge, preset, className, style }: Props) {
  const a = (address || "").toLowerCase().replace(/^0x/, "");
  const h1 = hueAt(a, 0);
  const h2 = (h1 + 55 + hueAt(a, 6) % 140) % 360;
  const initial = (username?.trim()?.[0] ?? a.slice(0, 1) ?? "?").toUpperCase();
  const ring = Math.max(2, Math.round(size * 0.06));

  const p = getAvatarPreset(preset);
  const background = p
    ? `linear-gradient(135deg, ${p.from}, ${p.to})`
    : `linear-gradient(135deg, hsl(${h1} 78% 62%), hsl(${h2} 82% 44%))`;

  return (
    <div className={className} style={{ position: "relative", width: size, height: size, flexShrink: 0, ...style }}>
      <div
        style={{
          width: size, height: size, borderRadius: "50%",
          background,
          border: `${ring}px solid ${ringColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontWeight: 900,
          fontSize: p ? Math.round(size * 0.5) : Math.round(size * 0.42),
          fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1, userSelect: "none",
          boxShadow: "inset 0 2px 6px rgba(255,255,255,0.28), inset 0 -3px 8px rgba(0,0,0,0.28)",
          boxSizing: "border-box",
          textShadow: p?.dark ? "0 0 10px rgba(255,255,255,0.35)" : undefined,
        }}
      >
        {p ? <span style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))" }}>{p.emoji}</span> : initial}
      </div>
      {badge && (
        <div style={{
          position: "absolute", bottom: -Math.round(size * 0.04), right: -Math.round(size * 0.04),
          fontSize: Math.round(size * 0.36), lineHeight: 1,
          filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.4))", pointerEvents: "none",
        }}>
          {badge}
        </div>
      )}
    </div>
  );
}
