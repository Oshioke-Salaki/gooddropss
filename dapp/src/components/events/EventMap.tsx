"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE } from "@/components/map/style";

export interface EventMapDrop { lat: number; lng: number; amount: string }

/**
 * The venue, and the event's live drops around it. Static-feeling on purpose
 * (no rotate/pitch) — it answers "where is it", the hunt happens on the main map.
 */
export function EventMap({ venue, drops }: { venue: { lat: number; lng: number; name: string }; drops: EventMapDrop[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dropMarkers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current, style: MAP_STYLE, center: [venue.lng, venue.lat], zoom: 15.5,
      attributionControl: false, dragRotate: false, pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    const el = document.createElement("div");
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="background:#2727E2;color:#fff;font:500 12px/1 'DM Sans',sans-serif;padding:8px 12px;border-radius:999px;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 20px rgba(0,0,0,.25)"></div>
      <div style="width:10px;height:10px;background:#2727E2;transform:rotate(45deg);margin-top:-6px"></div></div>`;
    (el.firstElementChild!.firstElementChild as HTMLElement).textContent = venue.name;
    new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([venue.lng, venue.lat]).addTo(map);
    mapRef.current = map;
    // The map mounts inside a lazily-loaded card, often before the layout has
    // settled; without this it keeps the size it was born with and leaves a
    // blank strip. Re-measure whenever the box changes.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, [venue.lat, venue.lng, venue.name]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    dropMarkers.current.forEach((m) => m.remove());
    dropMarkers.current = drops.map((d) => {
      const el = document.createElement("div");
      el.innerHTML = `<img src="/treasure-chest.png" alt="" width="28" height="28" style="width:28px;height:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.4))">`;
      el.title = `${d.amount} G$`;
      return new maplibregl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(map);
    });
  }, [drops]);

  return <div ref={ref} className="w-full h-full" />;
}
