// Avatar. Always an explorer: the person's chosen character, skin tone and
// background, or (if they haven't chosen one, or chose a retired avatar) a
// stable explorer derived from their address. See lib/avatars.
// Optional rank RING + status BADGE let status visibly "level up".
import { avatarColor, avatarSrc, resolveAvatar } from "@/lib/avatars";

interface Props {
  address: string;
  /** Kept for callers that still pass it; the explorer art doesn't use initials. */
  username?: string | null;
  size?: number;
  /** ring colour — e.g. a rank/tier colour. Defaults to ink. */
  ringColor?: string;
  /** small emoji shown bottom-right (recruiter tier, top-hunter crown, etc.) */
  badge?: string | null;
  /** the stored avatar id (`ex-cNN-tN-bN`); anything else falls back to the default. */
  preset?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

export function Avatar({ address, size = 44, ringColor = "#111", badge, preset, className, style }: Props) {
  const a = resolveAvatar(preset, address);
  const ring = Math.max(2, Math.round(size * 0.06));

  return (
    <div
      className={className}
      style={{
        position: "relative", width: size, height: size, flexShrink: 0, borderRadius: "50%",
        background: avatarColor(a.background), border: `${ring}px solid ${ringColor}`,
        boxSizing: "border-box", ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarSrc(a.character, a.tone, size)}
        alt=""
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        style={{
          position: "absolute", inset: -ring, width: size, height: size, borderRadius: "50%",
          display: "block", objectFit: "cover", userSelect: "none",
        }}
      />
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
