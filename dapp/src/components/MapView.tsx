"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { formatG$, gpsToDeg, haversineDistance } from "@/lib/utils";
import { CLAIM_RADIUS_M } from "@/lib/contracts";
import { MapPin, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import type { Drop, LatLng, Spot, Landmark } from "@/types";
import { DROP_STATUS } from "@/types";
import {
  dropBadgeHTML, clusterBadgeHTML, landmarkBadgeHTML,
  landmarkBadgeSize, PIN_TIP, LM,
} from "@/components/map/markers";
import { MAP_STYLE } from "@/components/map/style";
import { isLightDevice, prefersReducedMotion } from "@/lib/deviceTier";
import { MapZoomControls } from "@/components/MapZoomControls";
import { MyLocationButton } from "@/components/MyLocationButton";

type LocPerm = "unknown" | "prompt" | "granted" | "denied";



// ── Pin DOM builders ──────────────────────────────────────────────────────────
// MapLibre markers are plain DOM, so the badge markup lives in map/markers.ts and
// is injected as HTML. Keeping it there means the pill design has one home and
// Tailwind's scanner still sees the classes.

function makeDropElement(drop: Drop): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cursor = "pointer";
  // The pill sizes itself from its content; forcing a square box on the marker
  // element would clip the value chip.
  el.innerHTML = dropBadgeHTML(drop);
  return el;
}

function makeClusterElement(count: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cursor = "pointer";
  el.innerHTML = clusterBadgeHTML(count);
  return el;
}

// GoodSpots: merchant shops that accept G$. Same glass pill as the drop and
// landmark badges (markers.ts) so it reads as one family, with a shop icon in
// place of the chest and a brand chip in place of the value.
const SPOT_PILL_GLASS = "bg-[#FFFFFF33] backdrop-blur-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.22)]";
const STORE_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 21v-5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v5"/>' +
  '<path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 ' +
  '2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10' +
  'a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/>' +
  '<path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg>';
function makeSpotElement(spot: Spot): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cursor = "pointer";
  el.title = spot.name;
  el.innerHTML = `
    <div class="flex items-center gap-x-1.5 rounded-full ${SPOT_PILL_GLASS} p-0.5 pl-2 select-none font-sans">
      <span class="w-7 h-7 shrink-0 rounded-full bg-white text-heading flex items-center justify-center">${STORE_ICON}</span>
      <span class="whitespace-nowrap rounded-full bg-brand px-2 py-1.5 text-[11px]/none text-white lg:px-2.5 lg:py-2 lg:text-xs/none">
        G$ here
      </span>
    </div>`;
  return el;
}

// Place label. For hunters it's pointer-events:none so it can never intercept a
// tap meant for a drop pill sitting near it. For admins (`interactive`) the whole
// pill is the hit target and opens the manage sheet — no separate affordance, since
// only admins can click it and they already know.
function makeLandmarkElement(
  landmark: Landmark,
  interactive: boolean,
  dropCount: number,
  aggregate: boolean,
): HTMLDivElement {
  const el = document.createElement("div");
  el.style.pointerEvents = interactive ? "auto" : "none";
  if (interactive) el.style.cursor = "pointer";
  el.innerHTML = landmarkBadgeHTML({ name: landmark.name, dropCount, aggregate });
  return el;
}

function makeUserElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.innerHTML = `
    <div style="position:relative;width:24px;height:24px;pointer-events:none;">
      <div class="user-loc-pulse" style="
        position:absolute;inset:-10px;
        background:rgba(59,130,246,0.18);
        border:2px solid rgba(59,130,246,0.35);
        border-radius:50%;
      "></div>
      <div style="
        width:24px;height:24px;
        background:#3B82F6;
        border:3.5px solid #ffffff;
        border-radius:50%;
        box-shadow:0 2px 10px rgba(59,130,246,0.55);
      "></div>
    </div>`;
  return el;
}

// Temporary "here it is" highlight dropped when previewing a place from an admin
// list. Pulsing brand ring so it reads distinctly from the blue user dot.
function makeFocusElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.innerHTML = `
    <div style="position:relative;width:22px;height:22px;">
      <div class="user-loc-pulse" style="
        position:absolute;inset:-14px;
        background:rgba(39,39,226,0.18);
        border:2px solid rgba(39,39,226,0.55);
        border-radius:50%;
      "></div>
      <div style="
        width:22px;height:22px;
        background:#2727E2;
        border:3px solid #ffffff;
        border-radius:50%;
        box-shadow:0 2px 10px rgba(0,0,0,0.4);
      "></div>
    </div>`;
  return el;
}

// ── Geodesic circle polygon (claim radius) — no turf needed ──────────────────
function circlePolygon(lat: number, lng: number, radiusM: number, points = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = (radiusM / 6_371_000) * (180 / Math.PI);
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  drops: Drop[];
  onDropClick: (drop: Drop) => void;
  userLocation: LatLng | null;
  onUserLocation: (loc: LatLng) => void;
  spots?: Spot[];
  onSpotClick?: (spot: Spot) => void;
  landmarks?: Landmark[];
  /** Claim-activity hotspots (where hunters have found drops) for the demand
   *  heatmap. Toggled by `showHeatmap`. */
  heatmapPoints?: LatLng[];
  showHeatmap?: boolean;
  /** Fly to + briefly highlight a point (deep-link preview, e.g. from the admin
   *  Places/Suggestions lists). */
  focus?: { lat: number; lng: number } | null;
  /** Admin-only: makes landmark labels tappable and reports the tapped one so it
   *  can be edited/hidden/deleted right from the map. Hunters never get this. */
  interactiveLandmarks?: boolean;
  onLandmarkClick?: (landmark: Landmark) => void;
  /** When true, a tap on the map reports its coordinates via onMapPick (admin
   *  landmark placement) instead of doing nothing. */
  pickingMode?: boolean;
  onMapPick?: (lat: number, lng: number) => void;
}

type DropFeatureProps = { dropIndex: number };

// Below this zoom, landmark labels are hidden — they'd clutter and overlap when
// the map is pulled back. They appear as you zoom into a neighbourhood.
const LANDMARK_MIN_ZOOM = 13.5;
// Past this zoom the individual drop pills are far enough apart to read, so
// landmarks drop their aggregate count and the chests speak for themselves.
// Matches supercluster's own maxZoom below, so the two can't disagree.
const DROP_DETAIL_ZOOM = 17;

/**
 * True only in the zoom band where landmark pills are on screen AND carrying a
 * drop count — the one window in which a landmark speaks for its own drops.
 *
 * Outside it, nothing else represents them, so they must stay in the cluster
 * index. Pulled back past LANDMARK_MIN_ZOOM the labels are hidden entirely, and
 * that's exactly where excluding their drops made them vanish from the map
 * altogether: no label, no cluster, no trace that a place had 21 chests.
 */
function landmarksOwnDrops(zoom: number): boolean {
  return zoom >= LANDMARK_MIN_ZOOM && zoom < DROP_DETAIL_ZOOM;
}
// How close a drop has to be to count as "at" a landmark.
const LANDMARK_DROP_RADIUS_M = 150;
// Breathing room between two labels before they count as colliding.
const LABEL_GAP_PX = 6;

export default function MapView({
  drops, onDropClick, userLocation, onUserLocation,
  spots = [], onSpotClick, landmarks = [],
  heatmapPoints = [], showHeatmap = false, focus = null,
  interactiveLandmarks = false, onLandmarkClick,
  pickingMode = false, onMapPick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const lightRef = useRef(false);
  const flatRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const [locating, setLocating]         = useState(false);
  const [locateErr, setLocateErr]       = useState("");
  const [locPerm, setLocPerm]           = useState<LocPerm>("unknown");
  const [showNearbyList, setShowNearbyList] = useState(false);

  // Latest callbacks/data in refs so the map init effect never re-runs.
  const onDropClickRef = useRef(onDropClick);
  onDropClickRef.current = onDropClick;
  const onSpotClickRef = useRef(onSpotClick);
  onSpotClickRef.current = onSpotClick;
  const dropsRef = useRef(drops);
  dropsRef.current = drops;

  // Marker registries so re-renders can clear stale DOM markers.
  const dropMarkersRef     = useRef<maplibregl.Marker[]>([]);
  const spotMarkersRef     = useRef<maplibregl.Marker[]>([]);
  const landmarkMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef      = useRef<maplibregl.Marker | null>(null);

  // Kept in refs so the map-init effect (which runs once) always sees the latest.
  const landmarksRef   = useRef<Landmark[]>(landmarks);
  landmarksRef.current = landmarks;
  const pickingModeRef = useRef(pickingMode);
  pickingModeRef.current = pickingMode;
  const onMapPickRef   = useRef(onMapPick);
  onMapPickRef.current = onMapPick;
  const interactiveLandmarksRef = useRef(interactiveLandmarks);
  interactiveLandmarksRef.current = interactiveLandmarks;
  const onLandmarkClickRef = useRef(onLandmarkClick);
  onLandmarkClickRef.current = onLandmarkClick;
  const clusterRef     = useRef<Supercluster<DropFeatureProps> | null>(null);
  // Same drops, minus any a landmark is already counting. See the index effect.
  const clusterAwayRef = useRef<Supercluster<DropFeatureProps> | null>(null);

  const nearbyDrops = useMemo(() => {
    if (!userLocation) return [];
    const now = Math.floor(Date.now() / 1000);
    return drops
      .filter((d) => d.status === DROP_STATUS.Active && d.expiry > now)
      .map((d) => ({
        drop: d,
        dist: haversineDistance(userLocation.lat, userLocation.lng, gpsToDeg(d.lat), gpsToDeg(d.lng)),
      }))
      .filter(({ dist }) => dist <= CLAIM_RADIUS_M)
      .sort((a, b) => a.dist - b.dist);
  }, [drops, userLocation]);

  // ── Map init (runs once) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Light mode (Data Saver, 2G, low-RAM or low-core phones): no 3D buildings,
    // a flat camera and a capped render resolution — the three biggest GPU and
    // battery costs on an entry-level Android. See lib/deviceTier.
    lightRef.current = isLightDevice();
    flatRef.current = lightRef.current || prefersReducedMotion();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 2.4,
      maxPitch: flatRef.current ? 0 : 62,
      attributionControl: false,
      ...(lightRef.current
        ? { pixelRatio: Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5), fadeDuration: 0 }
        : {}),
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.touchZoomRotate.enableRotation();
    mapRef.current = map;

    // Admin landmark placement: a tap on empty map (not on a marker) reports its
    // coordinates. Only active while pickingMode is on (checked via ref).
    map.on("click", (e) => {
      if (pickingModeRef.current) onMapPickRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });

    map.on("load", () => {
      // Claim-radius circle source + layers (updated when user location changes)
      map.addSource("gd-claim-radius", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "gd-claim-radius-fill",
        type: "fill",
        source: "gd-claim-radius",
        paint: { "fill-color": "#3B82F6", "fill-opacity": 0.07 },
      });
      map.addLayer({
        id: "gd-claim-radius-line",
        type: "line",
        source: "gd-claim-radius",
        paint: { "line-color": "#3B82F6", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.6 },
      });

      // Demand heatmap — where hunters have claimed drops. Hidden until toggled.
      // Sits above the base tiles but below the DOM drop markers (which always
      // float on top), so hotspots never swallow a tap.
      map.addSource("gd-heatmap", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "gd-heatmap",
        type: "heatmap",
        source: "gd-heatmap",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 9, 1, 15, 2.4],
          "heatmap-radius":    ["interpolate", ["linear"], ["zoom"], 0, 6, 9, 22, 15, 45],
          "heatmap-opacity":   0.72,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0,    "rgba(0,0,0,0)",
            0.15, "rgba(90,130,20,0.35)",
            0.35, "rgba(150,200,30,0.55)",
            0.6,  "rgba(191,253,0,0.8)",   // brand lime
            0.8,  "rgba(255,200,0,0.9)",
            1,    "rgba(255,110,0,1)",      // hot
          ],
        },
      });

      // 3D buildings at close zoom — pure wow-factor; guarded because layer
      // naming varies across style versions and this must never break the map.
      try {
        if (lightRef.current) throw new Error("light device");
        const style = map.getStyle();
        const srcId = Object.keys(style.sources ?? {}).find(
          (k) => (style.sources as Record<string, { type?: string }>)[k]?.type === "vector",
        );
        if (srcId) {
          map.addLayer({
            id: "gd-3d-buildings",
            type: "fill-extrusion",
            source: srcId,
            "source-layer": "building",
            minzoom: 14.5,
            paint: {
              "fill-extrusion-color": "#1e2030",
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.7,
            },
          });
        }
      } catch { /* 3D buildings are optional — never block the map */ }

      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // ── Drop clustering + markers ───────────────────────────────────────────────
  const renderDropMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    // Below the detail zoom, landmarks speak for their own drops — so cluster
    // only the ones no landmark covers, or they'd be drawn twice.
    // Only hand the landmark-adjacent drops over while a landmark is actually
    // showing their count; otherwise cluster everything.
    const index = landmarksOwnDrops(map.getZoom())
      ? clusterAwayRef.current
      : clusterRef.current;
    if (!index) return;

    dropMarkersRef.current.forEach((m) => m.remove());
    dropMarkersRef.current = [];

    const b = map.getBounds();
    const clusters = index.getClusters(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      Math.floor(map.getZoom()),
    );

    for (const feature of clusters) {
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      let el: HTMLDivElement;

      if ("cluster" in feature.properties && feature.properties.cluster) {
        const clusterId = feature.properties.cluster_id as number;
        el = makeClusterElement(feature.properties.point_count as number);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const zoom = index.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: [lng, lat], zoom: Math.min(zoom, 18), duration: 600 });
        });
      } else {
        const drop = dropsRef.current[(feature.properties as DropFeatureProps).dropIndex];
        if (!drop) continue;
        el = makeDropElement(drop);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onDropClickRef.current(drop);
        });
      }

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
      dropMarkersRef.current.push(marker);
    }
  }, []);

  // Rebuild the cluster index when drops change, then re-render.
  //
  // Two indexes, because below DROP_DETAIL_ZOOM a landmark shows the count for
  // its own drops. If those drops were also in the cluster index you'd see the
  // same eleven chests twice — once on the landmark pill, once as a cluster blob
  // beside it. The `awayFromLandmarks` index is the same drops MINUS anything a
  // landmark is already speaking for, so at low zoom every drop is represented
  // exactly once. Above the threshold the full index is used and every chest
  // stands on its own point.
  useEffect(() => {
    if (!mapReady) return;
    const build = (list: { d: Drop; i: number }[]) => {
      const index = new Supercluster<DropFeatureProps>({ radius: 62, maxZoom: DROP_DETAIL_ZOOM });
      index.load(
        list.map(({ d, i }) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [gpsToDeg(d.lng), gpsToDeg(d.lat)] },
          properties: { dropIndex: i },
        })),
      );
      return index;
    };

    const all = drops.map((d, i) => ({ d, i }));
    const active = landmarks.filter((l) => l.status === "active");
    clusterRef.current = build(all);
    clusterAwayRef.current = build(
      all.filter(
        ({ d }) =>
          !active.some(
            (l) =>
              haversineDistance(l.lat, l.lng, gpsToDeg(d.lat), gpsToDeg(d.lng)) <=
              LANDMARK_DROP_RADIUS_M,
          ),
      ),
    );
    renderDropMarkers();
  }, [drops, landmarks, mapReady, renderDropMarkers]);

  // Re-cluster as the viewport moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handler = () => renderDropMarkers();
    map.on("moveend", handler);
    map.on("zoomend", handler);
    return () => {
      map.off("moveend", handler);
      map.off("zoomend", handler);
    };
  }, [mapReady, renderDropMarkers]);

  // ── Shop (GoodSpot) markers ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    spotMarkersRef.current.forEach((m) => m.remove());
    spotMarkersRef.current = spots.map((spot) => {
      const el = makeSpotElement(spot);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSpotClickRef.current?.(spot);
      });
      return new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map);
    });
    return () => {
      spotMarkersRef.current.forEach((m) => m.remove());
      spotMarkersRef.current = [];
    };
  }, [spots, mapReady]);

  // ── Landmark labels (zoom-gated, viewport-culled, collision-culled) ────────
  const renderLandmarkMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    landmarkMarkersRef.current.forEach((m) => m.remove());
    landmarkMarkersRef.current = [];
    const zoom = map.getZoom();
    if (zoom < LANDMARK_MIN_ZOOM) return; // hidden when pulled back
    const bounds = map.getBounds();
    const interactive = interactiveLandmarksRef.current;

    // Below DROP_DETAIL_ZOOM the individual chests are clustered, so a landmark
    // carries the count for its own drops instead — "12 chests at Uptown Mall"
    // rather than one anonymous cluster blob sitting on top of the label.
    const aggregate = landmarksOwnDrops(zoom);
    const liveDrops = aggregate
      ? dropsRef.current.filter(
          (d) => d.status === DROP_STATUS.Active && d.expiry > Math.floor(Date.now() / 1000),
        )
      : [];

    // Candidates, with their screen box, ranked by what deserves the space.
    const candidates = [];
    const centre = map.getCenter();
    for (const lm of landmarksRef.current) {
      if (lm.status !== "active") continue;
      if (!Number.isFinite(lm.lat) || !Number.isFinite(lm.lng)) continue;
      if (!bounds.contains([lm.lng, lm.lat])) continue; // only render what's on-screen

      const dropCount = aggregate
        ? liveDrops.filter(
            (d) =>
              haversineDistance(lm.lat, lm.lng, gpsToDeg(d.lat), gpsToDeg(d.lng)) <=
              LANDMARK_DROP_RADIUS_M,
          ).length
        : 0;

      const pt = map.project([lm.lng, lm.lat]);
      const size = landmarkBadgeSize(lm.name, aggregate && dropCount > 0);
      candidates.push({
        lm,
        dropCount,
        // The pin's tip is at `pt`, so the box hangs up-and-right of it.
        box: {
          left: pt.x - PIN_TIP.x,
          top: pt.y - size.h + (LM.height - PIN_TIP.y),
          right: pt.x - PIN_TIP.x + size.w,
          bottom: pt.y + (LM.height - PIN_TIP.y),
        },
        dist: haversineDistance(centre.lat, centre.lng, lm.lat, lm.lng),
      });
    }

    // Busiest places win, then whatever is closest to where you're looking. A map
    // with 20 overlapping labels is less readable than one with 8, so the rest are
    // dropped rather than stacked — they reappear as you zoom in and space opens up.
    candidates.sort((a, b) => b.dropCount - a.dropCount || a.dist - b.dist);

    const placed: { left: number; top: number; right: number; bottom: number }[] = [];
    const overlaps = (a: typeof placed[number], b: typeof placed[number]) =>
      a.left < b.right + LABEL_GAP_PX &&
      a.right + LABEL_GAP_PX > b.left &&
      a.top < b.bottom + LABEL_GAP_PX &&
      a.bottom + LABEL_GAP_PX > b.top;

    for (const c of candidates) {
      if (placed.some((p) => overlaps(c.box, p))) continue;
      placed.push(c.box);

      const el = makeLandmarkElement(c.lm, interactive, c.dropCount, aggregate);
      if (interactive) {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onLandmarkClickRef.current?.(c.lm);
        });
      }
      // The pill's box is the anchor, but the PIN's tip is what marks the spot —
      // it's absolutely positioned and overhangs the pill, so offset the element
      // by the tip's coordinates inside it.
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "top-left",
        offset: [-PIN_TIP.x, -PIN_TIP.y],
      })
        .setLngLat([c.lm.lng, c.lm.lat])
        .addTo(map);
      landmarkMarkersRef.current.push(marker);
    }
  }, []);

  // `drops` matters here too: the aggregate count on each pill is derived from the
  // live drops nearby, so a new drop or a claim has to redraw the labels. Without
  // it the counts only refreshed on the next pan or zoom.
  useEffect(() => {
    if (!mapReady) return;
    renderLandmarkMarkers();
  }, [landmarks, drops, mapReady, interactiveLandmarks, renderLandmarkMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handler = () => renderLandmarkMarkers();
    map.on("moveend", handler);
    map.on("zoomend", handler);
    return () => { map.off("moveend", handler); map.off("zoomend", handler); };
  }, [mapReady, renderLandmarkMarkers]);

  // Crosshair cursor while placing a landmark.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getCanvas().style.cursor = pickingMode ? "crosshair" : "";
    return () => { const m = mapRef.current; if (m) m.getCanvas().style.cursor = ""; };
  }, [pickingMode, mapReady]);

  // Deep-link preview: fly to a point and drop a brief highlight (from the admin
  // Places / Suggestions lists). Cleans itself up after a few seconds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focus) return;
    if (!Number.isFinite(focus.lat) || !Number.isFinite(focus.lng)) return;
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(map.getZoom(), 16.5),
      duration: 1400,
      essential: true,
    });
    const marker = new maplibregl.Marker({ element: makeFocusElement(), anchor: "center" })
      .setLngLat([focus.lng, focus.lat])
      .addTo(map);
    const t = setTimeout(() => marker.remove(), 6500);
    return () => { clearTimeout(t); marker.remove(); };
  }, [focus, mapReady]);

  // Demand heatmap: feed claim points + toggle the layer's visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("gd-heatmap") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: "FeatureCollection",
        features: heatmapPoints
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .map((p) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
            properties: {},
          })),
      });
    }
    if (map.getLayer("gd-heatmap")) {
      map.setLayoutProperty("gd-heatmap", "visibility", showHeatmap ? "visible" : "none");
    }
  }, [heatmapPoints, showHeatmap, mapReady]);

  // ── User location marker + claim radius ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (userLocation) {
      if (!userMarkerRef.current) {
        userMarkerRef.current = new maplibregl.Marker({ element: makeUserElement(), anchor: "center" })
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(map);
      } else {
        userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
      }
      const src = map.getSource("gd-claim-radius") as maplibregl.GeoJSONSource | undefined;
      src?.setData(circlePolygon(userLocation.lat, userLocation.lng, CLAIM_RADIUS_M));
    }
  }, [userLocation, mapReady]);

  // ── Geolocation permission flow ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    function doRequest() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          onUserLocation(loc);
          setLocPerm("granted");
          mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 16, pitch: flatRef.current ? 0 : 48, duration: flatRef.current ? 0 : 1800 });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setLocPerm("denied");
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
      );
    }

    if (!navigator.permissions) {
      doRequest();
      return;
    }

    navigator.permissions.query({ name: "geolocation" }).then((result) => {
      setLocPerm(result.state as LocPerm);
      if (result.state === "granted" || result.state === "prompt") doRequest();
      result.onchange = () => {
        const s = result.state as LocPerm;
        setLocPerm(s);
        if (s === "granted") {
          setLocateErr("");
          doRequest();
        }
      };
    }).catch(() => doRequest());
  }, [onUserLocation]);  

  // Continuous high-accuracy watch once permission is granted.
  useEffect(() => {
    if (locPerm !== "granted" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => onUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [locPerm, onUserLocation]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateErr("Geolocation not supported");
      return;
    }
    setLocating(true);
    setLocateErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onUserLocation(loc);
        mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 17, pitch: flatRef.current ? 0 : 48, duration: flatRef.current ? 0 : 1400 });
        setLocating(false);
        setLocPerm("granted");
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocPerm("denied");
          setLocateErr("Location denied — enable in browser settings & reload");
        } else if (err.code === err.TIMEOUT) {
          setLocateErr("GPS timed out — try again");
        } else {
          setLocateErr("Couldn't get location");
        }
        setTimeout(() => setLocateErr(""), 5_000);
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 },
    );
  }, [onUserLocation]);

  function flyToUser() {
    if (locPerm === "denied") {
      setLocateErr("Location denied — enable in browser settings & reload");
      setTimeout(() => setLocateErr(""), 5_000);
      return;
    }
    if (mapRef.current && userLocation) {
      mapRef.current.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17, pitch: flatRef.current ? 0 : 48, duration: flatRef.current ? 0 : 1400 });
      return;
    }
    requestLocation();
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Landmark placement: pan so the crosshair sits on the spot, then confirm.
          Reliable even in a tilted 3D view where a clean "click" rarely fires. */}
      {pickingMode && (
        <>
          {/* The same pin the landmark labels use; its tip sits on the map centre. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/location-pin.svg"
            alt=""
            aria-hidden
            width={30}
            height={48}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-[1150] pointer-events-none
              w-[30px] h-12 drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)] select-none"
          />
          <button
            type="button"
            onClick={() => { const c = mapRef.current?.getCenter(); if (c) onMapPick?.(c.lat, c.lng); }}
            className="absolute left-1/2 -translate-x-1/2 z-[1150] font-sans h-12 pl-4 pr-6 rounded-full bg-brand text-white
              text-sm/none flex items-center gap-2 whitespace-nowrap cursor-pointer
              shadow-[0px_4px_16px_0px_#2727E240] motion-safe:transition-colors hover:bg-brand/90"
            style={{ bottom: "calc(120px + var(--gd-cold-inset, 0px))" }}
          >
            <MapPin className="w-[18px] h-[18px]" strokeWidth={2} />
            Place here
          </button>
        </>
      )}

      {/* ── Map controls (zoom + locate) ──────────────────────────────────
          One bottom-left stack so the two never drift apart. `fixed` with the
          same bottom/inset as the action stack in page.tsx, so both corners
          share a baseline on every breakpoint (the map box stops above the
          mobile bottom nav, so `absolute` here would sit lower than `fixed`
          there). Every sheet is z-1001+, so they still cover these. */}
      <div
        className="fixed z-[1000] flex flex-col items-start gap-3 left-5 lg:left-[60px]
          bottom-[calc(20px+var(--gd-cold-inset,0px))] lg:bottom-[calc(60px+var(--gd-cold-inset,0px))] transition-[bottom] duration-200"
      >
        <MapZoomControls map={mapReady ? mapRef.current : null} />
        <MyLocationButton
          onClick={flyToUser}
          locating={locating}
          denied={locPerm === "denied"}
          error={locateErr || undefined}
        />
      </div>

      {/* ── Nearby drops chip + list ──────────────────────────────────────── */}
      {nearbyDrops.length > 0 && (
        <>
          {showNearbyList && (
            <div onClick={() => setShowNearbyList(false)} className="absolute inset-0 z-[1000]" aria-hidden />
          )}

          {showNearbyList && nearbyDrops.length > 1 && (
            <div
              role="menu"
              aria-label="Drops in claim range"
              className="absolute bottom-[68px] left-1/2 -translate-x-1/2 z-[1001] font-sans
                w-[min(300px,calc(100vw-24px))] bg-white rounded-2xl shadow-[0px_0px_12px_0px_#0000000A] overflow-hidden"
            >
              <p className="px-4 pt-3.5 pb-2.5 text-xs/none text-nav-muted border-b border-line">In claim range</p>
              {nearbyDrops.map(({ drop, dist }) => (
                <button
                  key={String(drop.id)}
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowNearbyList(false); onDropClick(drop); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-line last:border-b-0 text-left
                    cursor-pointer motion-safe:transition-colors hover:bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/treasure-chest.png" alt="" width={32} height={32} className="w-8 h-8 shrink-0 select-none" />
                  <span className="flex-1 min-w-0 flex flex-col gap-y-1">
                    <span className="text-sm/none text-heading">{formatG$(drop.amount)} G$</span>
                    <span className="text-xs/none text-nav-muted">{Math.round(dist)}m away</span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-nav-muted" strokeWidth={2} />
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (nearbyDrops.length === 1) {
                onDropClick(nearbyDrops[0].drop);
              } else {
                setShowNearbyList((v) => !v);
              }
            }}
            aria-expanded={nearbyDrops.length > 1 ? showNearbyList : undefined}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1001] font-sans h-11 p-1 pr-5 rounded-full
              bg-brand text-white text-sm/none flex items-center gap-2.5 whitespace-nowrap cursor-pointer
              shadow-[0px_4px_16px_0px_#2727E240] motion-safe:transition-colors hover:bg-brand/90"
          >
            <span className="w-9 h-9 shrink-0 rounded-full bg-white/15 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/treasure-chest.png" alt="" width={26} height={26} className="w-[26px] h-[26px] select-none" />
            </span>
            {nearbyDrops.length === 1
              ? `${formatG$(nearbyDrops[0].drop.amount)} G$ — claim now`
              : `${nearbyDrops.length} drops in range`}
            {nearbyDrops.length > 1 && (
              showNearbyList
                ? <ChevronUp className="w-4 h-4 opacity-80" strokeWidth={2} />
                : <ChevronDown className="w-4 h-4 opacity-80" strokeWidth={2} />
            )}
          </button>
        </>
      )}

    </div>
  );
}
