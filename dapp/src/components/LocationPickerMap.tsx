"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { landmarkBadgeHTML, PIN_TIP } from "@/components/map/markers";
import type { Landmark } from "@/types";
import { MAP_STYLE } from "@/components/map/style";
import { addBuildings } from "@/components/map/buildings";


// Shared with MapView. Picking a location and then seeing your drop on the map
// should look like one continuous surface — a light "positron" picker made this
// screen read as a different app.

export interface Props {
  initialCenter: { lat: number; lng: number };
  flyTarget: { lat: number; lng: number; seq: number } | null;
  onCenterChange: (lat: number, lng: number) => void;
  onDragChange: (dragging: boolean) => void;
  /** Fires only on a USER gesture (drag/zoom), never a programmatic flyTo — lets
   *  the parent stop auto-following the live location once the user takes over. */
  onUserInteract?: () => void;
  landmarks?: Landmark[];
  /** Hands the live map out so the shared zoom controls can drive it. */
  onMapReady?: (map: maplibregl.Map | null) => void;
}

export default function LocationPickerMap({
  initialCenter,
  flyTarget,
  onCenterChange,
  onDragChange,
  onUserInteract,
  landmarks = [],
  onMapReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const lastSeqRef   = useRef(-1);
  // Pointer-down sample, used to tell a tap from a pan on pointerup.
  const tapRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const landmarkMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Latest callbacks in refs so the init effect never needs to re-run.
  const onCenterRef = useRef(onCenterChange);
  onCenterRef.current = onCenterChange;
  const onDragRef = useRef(onDragChange);
  onDragRef.current = onDragChange;
  const onUserRef = useRef(onUserInteract);
  onUserRef.current = onUserInteract;
  const onReadyRef = useRef(onMapReady);
  onReadyRef.current = onMapReady;

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
    // Hand the instance up once it can take commands, so the shared zoom controls
    // drive this map exactly as they drive the main one.
    map.once("load", () => {
      addBuildings(map, { mode: "3d" }); // same brand-blue buildings as the main map
      onReadyRef.current?.(map);
    });

    // ── Tap to place ──────────────────────────────────────────────────────
    // The pin IS the map centre, so "tap here" is simply "recentre here" — one
    // model, no modes, and the pin never has to know how it got moved.
    //
    // Deliberately not MapLibre's `click`: that still fires at the end of a pan,
    // which would yank the map on every drag. Measuring the pointer is exact and
    // doesn't depend on library internals — under a few px and a few hundred ms
    // is a tap; anything more was a drag and is left alone.
    const TAP_SLOP_PX = 6;
    const TAP_MAX_MS = 400;
    const canvas = map.getCanvas();

    const onDown = (e: PointerEvent) => {
      // A second finger means a pinch, not a tap — abandon the sample.
      if (!e.isPrimary) { tapRef.current = null; return; }
      tapRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      const down = tapRef.current;
      tapRef.current = null;
      if (!down || e.pointerId !== down.id) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP_PX) return;
      if (performance.now() - down.t > TAP_MAX_MS) return;
      const rect = canvas.getBoundingClientRect();
      const target = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      // Counts as taking control, so follow-mode stops chasing the GPS fix.
      onUserRef.current?.();
      map.easeTo({ center: target, duration: 350 });
    };
    const onCancel = () => { tapRef.current = null; };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);

    // The pin is a fixed crosshair in the parent; we just report the centre.
    // `originalEvent` is present only for real gestures (drag/pinch/wheel) — a
    // programmatic flyTo has none, so this cleanly tells "user moved it" apart.
    map.on("movestart", (e) => {
      onDragRef.current(true);
      if ((e as { originalEvent?: unknown }).originalEvent) onUserRef.current?.();
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      onDragRef.current(false);
      onCenterRef.current(c.lat, c.lng);
    });

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      onReadyRef.current?.(null);
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

  // ── Landmark markers — the SAME pills the main map draws, so the place you
  //    pick looks like the place you saw. Built from the shared marker module.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of landmarkMarkersRef.current) m.remove();
    landmarkMarkersRef.current = [];

    for (const lm of landmarks) {
      if (lm.status !== "active" || !Number.isFinite(lm.lat) || !Number.isFinite(lm.lng)) continue;
      const el = document.createElement("div");
      el.style.pointerEvents = "none";
      // No count here: the picker has no drop data, and a pill claiming "0" would
      // be worse than one that simply names the place.
      el.innerHTML = landmarkBadgeHTML({ name: lm.name, dropCount: 0, aggregate: false });
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "top-left",
        offset: [-PIN_TIP.x, -PIN_TIP.y],
      })
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

    </div>
  );
}
