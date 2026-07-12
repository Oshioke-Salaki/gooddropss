"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Plus, Minus } from "lucide-react";

// Light vector style (keyless) — matches the old Carto "light" look, but as
// vector tiles: sharper, faster, and no API key / rate limits.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export interface Props {
  initialCenter: { lat: number; lng: number };
  flyTarget: { lat: number; lng: number; seq: number } | null;
  onCenterChange: (lat: number, lng: number) => void;
  onDragChange: (dragging: boolean) => void;
}

export default function LocationPickerMap({
  initialCenter,
  flyTarget,
  onCenterChange,
  onDragChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const lastSeqRef   = useRef(-1);

  // Latest callbacks in refs so the init effect never needs to re-run.
  const onCenterRef = useRef(onCenterChange);
  onCenterRef.current = onCenterChange;
  const onDragRef = useRef(onDragChange);
  onDragRef.current = onDragChange;

  // ── Init (once) ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [initialCenter.lng, initialCenter.lat],
      zoom: 17,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    // The pin is a fixed crosshair in the parent; we just report the centre.
    map.on("movestart", () => onDragRef.current(true));
    map.on("moveend", () => {
      const c = map.getCenter();
      onDragRef.current(false);
      onCenterRef.current(c.lat, c.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // initialCenter is only the starting position — intentionally not a dep.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fly to a programmatic target (search result / "my location") ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTarget) return;
    if (flyTarget.seq === lastSeqRef.current) return;
    lastSeqRef.current = flyTarget.seq;
    map.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 17, duration: 700 });
  }, [flyTarget]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Zoom controls */}
      <div
        style={{
          position: "absolute",
          bottom: 76,
          right: 12,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          border: "2px solid #111",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "2px 2px 0 #111",
        }}
      >
        {[{ Icon: Plus, delta: 1 }, { Icon: Minus, delta: -1 }].map(({ Icon, delta }) => (
          <button
            key={delta}
            onClick={() => {
              const map = mapRef.current;
              if (!map) return;
              if (delta === 1) map.zoomIn({ duration: 250 });
              else map.zoomOut({ duration: 250 });
            }}
            style={{
              width: 36, height: 36,
              background: "#fff",
              border: "none",
              borderBottom: delta === 1 ? "1.5px solid #111" : "none",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#BFFD00"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >
            <Icon size={18} strokeWidth={2.5} color="#111" />
          </button>
        ))}
      </div>
    </div>
  );
}
