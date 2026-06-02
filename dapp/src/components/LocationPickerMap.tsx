"use client";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Plus, Minus } from "lucide-react";

let mountCount = 0;

// Flies the map to a programmatic target (search result or "my location").
// Uses a seq counter so the same coords can retrigger a fly.
function FlyController({
  target,
}: {
  target: { lat: number; lng: number; seq: number } | null;
}) {
  const map = useMap();
  const lastSeq = useRef(-1);
  useEffect(() => {
    if (!target || target.seq === lastSeq.current) return;
    lastSeq.current = target.seq;
    map.flyTo([target.lat, target.lng], 16, { animate: true, duration: 0.7 });
  }, [target, map]);
  return null;
}

// Reports movestart (dragging) and moveend (settled) to parent.
function MoveHandler({
  onDrag,
  onSettle,
}: {
  onDrag: () => void;
  onSettle: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    movestart: () => onDrag(),
    moveend: (e) => {
      const c = (e.target as L.Map).getCenter();
      onSettle(c.lat, c.lng);
    },
  });
  return null;
}

// Captures the Leaflet map instance into a ref owned by the parent.
function MapRefCapture({
  mapRef,
}: {
  mapRef: React.MutableRefObject<L.Map | null>;
}) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => { mapRef.current = null; };
  }, [map, mapRef]);
  return null;
}

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
  const [mapKey] = useState(() => ++mountCount);
  const mapRef = useRef<L.Map | null>(null);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MapContainer
        key={mapKey}
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={14}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={20}
        />
        <MoveHandler
          onDrag={() => onDragChange(true)}
          onSettle={(lat, lng) => {
            onDragChange(false);
            onCenterChange(lat, lng);
          }}
        />
        <FlyController target={flyTarget} />
        <MapRefCapture mapRef={mapRef} />
      </MapContainer>

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
            onClick={() => mapRef.current?.setZoom((mapRef.current.getZoom()) + delta)}
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
