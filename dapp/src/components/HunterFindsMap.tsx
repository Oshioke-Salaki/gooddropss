"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { addBuildings } from "@/components/map/buildings";
import { MAP_STYLE } from "@/components/map/style"; // same style as every other map

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
      addBuildings(map, { mode: "flat" }); // top-down map: brand-blue footprints
      const bounds = new maplibregl.LngLatBounds();
      for (const p of points) {
        const el = document.createElement("div");
        el.style.cssText =
          `width:14px;height:14px;border-radius:50%;background:${p.color};` +
          `border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.25),0 0 8px ${p.color};`;
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
    // The parent card supplies the rounded border; this stays chrome-free so
    // it can sit inside any container.
    <div className="relative h-[220px] overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      <div
        className="absolute top-3 right-3 bg-white text-heading text-sm/none px-3 py-2 rounded-full pointer-events-none"
        style={{ boxShadow: "0px 0px 12px 0px #0000000A" }}
      >
        {points.length} {points.length === 1 ? "find" : "finds"}
      </div>
    </div>
  );
}
