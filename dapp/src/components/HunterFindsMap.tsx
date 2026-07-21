"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Same keyless tiles the main map uses.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

export interface FindPoint {
  lat: number;    // degrees
  lng: number;    // degrees
  amount: string; // formatted, e.g. "40"
  color: string;  // rarity color
}

/**
 * Compact map of where a hunter has claimed drops. Coordinates are already in
 * degrees and pre-filtered server-side (private drops — stored as 0,0 — excluded).
 * Renders nothing when there are no public finds to show.
 */
export function HunterFindsMap({ points }: { points: FindPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || points.length === 0) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.resize();
      const bounds = new maplibregl.LngLatBounds();
      for (const p of points) {
        const el = document.createElement("div");
        el.style.cssText =
          `width:15px;height:15px;border-radius:50%;background:${p.color};` +
          `border:2px solid #111;box-shadow:0 0 8px ${p.color};`;
        el.title = `${p.amount} G$`;
        new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
        bounds.extend([p.lng, p.lat]);
      }
      if (points.length === 1) {
        map.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 13 });
      } else {
        map.fitBounds(bounds, { padding: 44, maxZoom: 14, duration: 0 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  if (points.length === 0) return null;

  return (
    <div className="relative rounded-2xl border-2 border-ink overflow-hidden shadow-brutal" style={{ height: 240 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div className="absolute top-2 right-2 bg-ink text-lime text-[10px] font-black px-2 py-1 rounded-full pointer-events-none">
        {points.length} {points.length === 1 ? "find" : "finds"}
      </div>
    </div>
  );
}
