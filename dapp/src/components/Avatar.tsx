// Deterministic generated avatar — no uploads, no storage, consistent everywhere
// a person appears (profile, leaderboard, nav). A two-tone gradient + monogram
// derived from the wallet, with an optional rank RING and status BADGE so status
// can visibly "level up" (the mentor's grow-with-achievement idea, applied where
// it's safe — never by exposing anyone's live location on the map).

interface Props {
  address: string;
  username?: string | null;
  size?: number;
  /** ring colour — e.g. a rank/tier colour. Defaults to ink. */
  ringColor?: string;
  /** small emoji shown bottom-right (recruiter tier, top-hunter crown, etc.) */
  badge?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

function hueAt(hex: string, start: number): number {
  const slice = hex.slice(start, start + 6) || "0";
  return parseInt(slice, 16) % 360 || 0;
}

export function Avatar({ address, username, size = 44, ringColor = "#111", badge, className, style }: Props) {
  const a = (address || "").toLowerCase().replace(/^0x/, "");
  const h1 = hueAt(a, 0);
  const h2 = (h1 + 55 + hueAt(a, 6) % 140) % 360;
  const initial = (username?.trim()?.[0] ?? a.slice(0, 1) ?? "?").toUpperCase();
  const ring = Math.max(2, Math.round(size * 0.06));

  return (
    <div className={className} style={{ position: "relative", width: size, height: size, flexShrink: 0, ...style }}>
      <div
        style={{
          width: size, height: size, borderRadius: "50%",
          background: `linear-gradient(135deg, hsl(${h1} 78% 62%), hsl(${h2} 82% 44%))`,
          border: `${ring}px solid ${ringColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontWeight: 900, fontSize: Math.round(size * 0.42),
          fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1, userSelect: "none",
          boxShadow: "inset 0 2px 6px rgba(255,255,255,0.28), inset 0 -3px 8px rgba(0,0,0,0.28)",
          boxSizing: "border-box",
        }}
      >
        {initial}
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
