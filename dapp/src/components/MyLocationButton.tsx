"use client";
import { Loader2, MapPin, MapPinOff } from "lucide-react";

interface Props {
  onClick: () => void;
  /** A fix is being acquired — the pill shows a spinner and stops accepting taps. */
  locating?: boolean;
  /** The browser refused geolocation; only a settings change can undo it. */
  denied?: boolean;
  /** Transient failure text, shown in a tooltip above the pill. */
  error?: string;
}

/**
 * "My location" pill — recentres the map on the hunter.
 *
 * Purely presentational: the permission flow, the watch, and the flyTo all live
 * in MapView, which owns the map instance. This just renders the three states
 * (idle / locating / denied) and reports taps.
 */
export function MyLocationButton({ onClick, locating = false, denied = false, error }: Props) {
  const label = locating ? "Locating…" : denied ? "Location off" : "My location";

  return (
    <div className="relative w-fit font-sans">
      {error && (
        <div
          role="status"
          className="absolute bottom-full left-0 mb-2 max-w-[220px] rounded-lg bg-nav-active px-2.5 py-1.5 text-xs font-semibold leading-snug text-white pointer-events-none"
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        disabled={locating}
        title={denied ? "Location access denied — enable it in your browser settings" : "Go to my location"}
        aria-label={label}
        className={`bg-surface border border-line rounded-full p-3 lg:px-4 flex items-center gap-3 transition-colors ${
          locating ? "cursor-wait opacity-70" : "cursor-pointer hover:bg-[#ECECEC] active:bg-[#E0E0E0]"
        }`}
      >
        {locating
          ? <Loader2 className="w-5 h-5 animate-spin text-nav-muted" />
          : denied
            ? <MapPinOff className="w-5 h-5 text-nav-muted" />
            : <MapPin className="w-5 h-5 text-nav-active" />}
        {/* Icon-only on phones: the bottom row also holds the drops-in-range pill
            and the + button, and the label is what made them collide. */}
        <span className={`hidden lg:inline text-sm/[100%] whitespace-nowrap ${denied ? "text-nav-muted" : "text-nav-active"}`}>
          {label}
        </span>
      </button>
    </div>
  );
}

export default MyLocationButton;
