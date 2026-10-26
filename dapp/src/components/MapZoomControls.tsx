"use client";
import { useEffect, useState, type MouseEvent } from "react";
import { Minus, Plus } from "lucide-react";
import type maplibregl from "maplibre-gl";

interface Props {
  /** The live map. Null until it finishes initialising — buttons stay inert. */
  map: maplibregl.Map | null;
  /** How many zoom levels one press moves. */
  step?: number;
}

// The container colour shows through the 1px gap as a hairline divider.
const TRACK = "bg-[#CBCBCB]";
const KEY = "h-11 w-11 bg-nav-controls flex justify-center items-center text-nav-active transition-colors";

/**
 * Zoom in/out for the map.
 *
 * Owns its own zoom-level subscription so each button can disable itself at the
 * style's min/max — pressing a dead button that silently does nothing is the
 * kind of hiccup that makes a map feel broken.
 */
export function MapZoomControls({ map, step = 1 }: Props) {
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    if (!map) { setZoom(null); return; }
    const sync = () => setZoom(map.getZoom());
    sync();
    // "zoom" (not "zoomend") so the limits update mid-gesture, not after it.
    map.on("zoom", sync);
    return () => { map.off("zoom", sync); };
  }, [map]);

  // A small epsilon: MapLibre lands fractionally short of the limit.
  const atMax = map != null && zoom != null && zoom >= map.getMaxZoom() - 0.01;
  const atMin = map != null && zoom != null && zoom <= map.getMinZoom() + 0.01;

  const nudge = (delta: number) => (e: MouseEvent) => {
    e.stopPropagation();
    if (!map) return;
    // easeTo from the *current* zoom so rapid taps compound instead of
    // fighting each other — zoomIn() re-reads a zoom that's still animating.
    map.easeTo({ zoom: map.getZoom() + delta, duration: 250 });
  };

  return (
    // Desktop only — on a phone you pinch to zoom, and the corner is better
    // spent on "My location".
    <div className={`hidden lg:flex rounded-full overflow-hidden gap-x-px w-fit ${TRACK}`}>
      <button
        type="button"
        onClick={nudge(-step)}
        disabled={!map || atMin}
        aria-label="Zoom out"
        className={`${KEY} ${atMin ? "opacity-40 cursor-default" : "hover:bg-[#E0E0E0] active:bg-[#D6D6D6] cursor-pointer"}`}
      >
        <Minus className="w-5 h-5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={nudge(step)}
        disabled={!map || atMax}
        aria-label="Zoom in"
        className={`${KEY} ${atMax ? "opacity-40 cursor-default" : "hover:bg-[#E0E0E0] active:bg-[#D6D6D6] cursor-pointer"}`}
      >
        <Plus className="w-5 h-5" strokeWidth={2} />
      </button>
    </div>
  );
}

export default MapZoomControls;
