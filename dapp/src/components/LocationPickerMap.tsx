"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Plus, Minus } from "lucide-react";
import { landmarkMeta } from "@/lib/landmarks";
import type { Landmark } from "@/types";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Same dark style as MapView and BatchDropCreator. Picking a location and then
// seeing your drop on the map should look like one continuous surface — a light
// "positron" picker made this screen read as a different app.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

export interface Props {
  initialCenter: { lat: number; lng: number };
  flyTarget: { lat: number; lng: number; seq: number } | null;
  onCenterChange: (lat: number, lng: number) => void;
  onDragChange: (dragging: boolean) => void;
  landmarks?: Landmark[];
}

export default function LocationPickerMap({
  initialCenter,
  flyTarget,
  onCenterChange,
  onDragChange,
  landmarks = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const lastSeqRef   = useRef(-1);
  const landmarkMarkersRef = useRef<maplibregl.Marker[]>([]);

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

  // ── Landmark markers — show our curated places so droppers have real context
  //    ("hide it near The Buidl Hub") instead of an anonymous dark map. ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of landmarkMarkersRef.current) m.remove();
    landmarkMarkersRef.current = [];

    for (const lm of landmarks) {
      if (lm.status !== "active" || !Number.isFinite(lm.lat) || !Number.isFinite(lm.lng)) continue;
      const meta = landmarkMeta(lm.category);
      const el = document.createElement("div");
      el.style.cssText = "display:flex;align-items:center;gap:4px;pointer-events:none;will-change:transform;";
      el.innerHTML =
        `<span style="font-size:15px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))">${meta.icon}</span>` +
        `<span style="font-size:10.5px;font-weight:800;color:#fff;background:rgba(17,17,17,.72);` +
        `border:1px solid ${meta.color}66;padding:1px 6px;border-radius:6px;white-space:nowrap;` +
        `text-shadow:0 1px 2px rgba(0,0,0,.6);letter-spacing:.01em;max-width:150px;overflow:hidden;` +
        `text-overflow:ellipsis">${escapeHtml(lm.name)}</span>`;
      const marker = new maplibregl.Marker({ element: el, anchor: "left" })
        .setLngLat([lm.lng, lm.lat])
        .addTo(map);
      landmarkMarkersRef.current.push(marker);
    }

    return () => {
      for (const m of landmarkMarkersRef.current) m.remove();
      landmarkMarkersRef.current = [];
    };
  }, [landmarks]);

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
