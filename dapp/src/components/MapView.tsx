"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { Navigation, MapPin, Plus, Minus } from "lucide-react";
import { formatG$, gpsToDeg, getDropRarity, RARITY, isFlashDrop, haversineDistance, parseDropHint } from "@/lib/utils";
import { CLAIM_RADIUS_M } from "@/lib/contracts";
import type { Drop, LatLng, Spot } from "@/types";
import { DROP_STATUS } from "@/types";

type LocPerm = "unknown" | "prompt" | "granted" | "denied";

// Free, no-API-key vector tiles (openfreemap.org) — crisp at every zoom,
// supports rotate/pitch, and removes the Stadia raster key requirement.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

// ── Pin DOM builders (rarity-aware, dark theme) ───────────────────────────────
// MapLibre markers are plain DOM elements, so every existing CSS pin animation
// (pin-pulse-*, pin-flash) carries over unchanged.

// The marker wrapper carries border-radius:50% AND the pin-pulse-* box-shadow,
// but the size only ever lived on the inner div — so the wrapper stretched to the
// full width of the map container. A 1400×58 element with border-radius:50% and a
// coloured glow renders as a giant ellipse straight across the map. Pin the
// wrapper to the pin's real size so its rounding and glow describe the circle we
// actually drew.
function sizeWrapper(el: HTMLDivElement, px: number) {
  el.style.width      = `${px}px`;
  el.style.height     = `${px}px`;
  el.style.boxSizing  = "border-box";
  el.style.lineHeight = "0";
}

function makeDropElement(drop: Drop): HTMLDivElement {
  const el = document.createElement("div");
  const active =
    drop.status === DROP_STATUS.Active &&
    drop.expiry > Math.floor(Date.now() / 1000);

  if (!active) {
    const isClaimed = drop.status === DROP_STATUS.Claimed;
    sizeWrapper(el, 36);
    el.innerHTML = `<div style="
      width:36px;height:36px;
      background:#1a1a2a;
      border:1.5px solid #333;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-weight:700;font-size:14px;color:#444;
      cursor:pointer;font-family:'Space Grotesk',sans-serif;
      user-select:none;
    ">${isClaimed ? "✓" : "↩"}</div>`;
    return el;
  }

  const flash = isFlashDrop(drop);
  // Parse properly rather than prefix-testing the raw hint: a riddle-locked
  // campaign drop is "[R][C:id]…", so /^\[C:/ would miss it and silently
  // downgrade the pin.
  const parsed     = parseDropHint(drop.hint);
  const isCampaign = parsed.campaignId !== null;
  const isChain    = parsed.chainNextId !== null || parsed.isChainLast;
  const hasRiddle  = parsed.hasRiddle;
  const rarity     = getDropRarity(drop.amount);
  const r          = RARITY[rarity];
  const label      = formatG$(drop.amount);

  // Riddle drops get a puzzle tag so a hunter knows there's a question waiting
  // before they walk a kilometre to find out.
  const riddleTag = hasRiddle
    ? `<div style="
        position:absolute;top:-4px;right:-4px;
        width:19px;height:19px;border-radius:50%;
        background:#111;border:1.5px solid #BFFD00;
        display:flex;align-items:center;justify-content:center;
        font-size:10px;line-height:1;
        pointer-events:none;
      ">🧩</div>`
    : "";
  if (hasRiddle) el.style.position = "relative";

  if (flash) {
    el.className = "pin-flash";
    sizeWrapper(el, 52);
    el.innerHTML = `<div style="
      width:52px;height:52px;
      background:#FF6400;
      border:2.5px solid rgba(0,0,0,0.5);
      border-radius:50%;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-weight:900;font-size:10px;color:#fff;
      cursor:pointer;
      font-family:'Space Grotesk',sans-serif;
      user-select:none;gap:1px;
    "><span style="font-size:13px;line-height:1;">⚡</span><span>${label}</span></div>${riddleTag}`;
    return el;
  }

  if (isChain) {
    el.className = r.animClass;
    el.style.borderRadius = "50%";
    sizeWrapper(el, 54);
    el.innerHTML = `<div style="
      width:54px;height:54px;
      background:#111;
      border:2.5px solid ${r.color};
      border-radius:50%;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-weight:900;font-size:10px;color:${r.color};
      cursor:pointer;
      font-family:'Space Grotesk',sans-serif;
      user-select:none;gap:1px;
      box-shadow:0 0 0 3px rgba(255,255,255,0.4);
    "><span style="font-size:13px;line-height:1;">🔗</span><span>${label}</span></div>${riddleTag}`;
    return el;
  }

  if (isCampaign) {
    el.className = r.animClass;
    el.style.borderRadius = "50%";
    sizeWrapper(el, 54);
    el.innerHTML = `<div style="
      width:54px;height:54px;
      background:${r.color};
      border:2.5px solid rgba(0,0,0,0.6);
      border-radius:50%;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-weight:900;font-size:10px;color:${r.textColor};
      cursor:pointer;
      font-family:'Space Grotesk',sans-serif;
      user-select:none;gap:1px;
      box-shadow:0 0 0 3px rgba(255,255,255,0.6);
    "><span style="font-size:11px;line-height:1;">⭐</span><span>${label}</span></div>${riddleTag}`;
    return el;
  }

  // Rarity-at-altitude: bigger, richer pins for rarer drops.
  const SIZE_BY_RARITY: Record<typeof rarity, { size: number; font: number; ring: string }> = {
    common:    { size: 40, font: 10, ring: "none" },
    uncommon:  { size: 48, font: 11, ring: "none" },
    rare:      { size: 58, font: 12, ring: "0 0 0 3px rgba(0,207,255,0.28)" },
    legendary: { size: 70, font: 14, ring: "0 0 0 4px rgba(255,215,0,0.4)" },
  };
  const s = SIZE_BY_RARITY[rarity];

  el.className = r.animClass;
  el.style.borderRadius = "50%";
  sizeWrapper(el, s.size);
  el.innerHTML = `<div style="
    width:${s.size}px;height:${s.size}px;
    background:${r.color};
    border:${rarity === "legendary" ? 3 : 2}px solid rgba(0,0,0,0.5);
    border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-weight:900;font-size:${s.font}px;color:${r.textColor};
    cursor:pointer;
    font-family:'Space Grotesk',sans-serif;
    user-select:none;
    box-shadow:${s.ring};
  ">${label}</div>${riddleTag}`;
  return el;
}

function makeClusterElement(count: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "pin-pulse-uncommon";
  el.style.borderRadius = "50%";
  sizeWrapper(el, 46);
  el.innerHTML = `<div style="
    width:46px;height:46px;
    background:#BFFD00;
    border:2px solid rgba(0,0,0,0.5);
    border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-weight:900;font-size:14px;color:#111;
    cursor:pointer;
    font-family:'Space Grotesk',sans-serif;
    user-select:none;
  ">${count}</div>`;
  return el;
}

// GoodSpots: merchant shops that accept G$ — square tag pin, distinct from drops.
function makeSpotElement(spot: Spot): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = `<div style="
    width:44px;height:44px;
    background:#111;
    border:2.5px solid #BFFD00;
    border-radius:12px 12px 12px 2px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    cursor:pointer;
    font-family:'Space Grotesk',sans-serif;
    user-select:none;
    box-shadow:0 2px 10px rgba(191,253,0,0.35);
  " title="${spot.name.replace(/"/g, "&quot;")}">
    <span style="font-size:17px;line-height:1;">🏪</span>
    <span style="font-size:7px;font-weight:900;color:#BFFD00;letter-spacing:0.04em;">G$ HERE</span>
  </div>`;
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
}

type DropFeatureProps = { dropIndex: number };

export default function MapView({ drops, onDropClick, userLocation, onUserLocation, spots = [], onSpotClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
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
  const dropMarkersRef = useRef<maplibregl.Marker[]>([]);
  const spotMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef  = useRef<maplibregl.Marker | null>(null);
  const clusterRef     = useRef<Supercluster<DropFeatureProps> | null>(null);

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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 2.4,
      maxPitch: 62,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.touchZoomRotate.enableRotation();
    mapRef.current = map;

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

      // 3D buildings at close zoom — pure wow-factor; guarded because layer
      // naming varies across style versions and this must never break the map.
      try {
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
    const index = clusterRef.current;
    if (!map || !index) return;

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
  useEffect(() => {
    if (!mapReady) return;
    const index = new Supercluster<DropFeatureProps>({ radius: 62, maxZoom: 17 });
    index.load(
      drops.map((d, i) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [gpsToDeg(d.lng), gpsToDeg(d.lat)] },
        properties: { dropIndex: i },
      })),
    );
    clusterRef.current = index;
    renderDropMarkers();
  }, [drops, mapReady, renderDropMarkers]);

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
          mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 16, pitch: 48, duration: 1800 });
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
  }, [onUserLocation]); // eslint-disable-line react-hooks/exhaustive-deps

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
        mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 17, pitch: 48, duration: 1400 });
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
      mapRef.current.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17, pitch: 48, duration: 1400 });
      return;
    }
    requestLocation();
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── Location status banner ────────────────────────────────────────── */}
      {locPerm === "denied" && !locateErr && (
        <div
          style={{
            position: "absolute",
            bottom: "100px",
            left: "64px",
            zIndex: 1000,
            background: "#111111",
            color: "#ffffff",
            fontSize: "12px",
            fontWeight: 600,
            padding: "6px 10px",
            borderRadius: "8px",
            whiteSpace: "nowrap",
            fontFamily: "inherit",
            pointerEvents: "none",
          }}
        >
          Location disabled
        </div>
      )}

      {/* ── Locate-me error tooltip ───────────────────────────────────────── */}
      {locateErr && (
        <div
          style={{
            position: "absolute",
            bottom: "100px",
            left: "64px",
            zIndex: 1000,
            background: "#111111",
            color: "#ffffff",
            fontSize: "12px",
            fontWeight: 600,
            padding: "6px 10px",
            borderRadius: "8px",
            maxWidth: "220px",
            fontFamily: "inherit",
            pointerEvents: "none",
          }}
        >
          {locateErr}
        </div>
      )}

      {/* ── Locate-me button ──────────────────────────────────────────────── */}
      <button
        onClick={(e) => { e.stopPropagation(); flyToUser(); }}
        title={locPerm === "denied" ? "Location access denied" : "Go to my location"}
        style={{
          position: "absolute",
          bottom: "48px",
          left: "12px",
          zIndex: 1000,
          width: "44px",
          height: "44px",
          background: locPerm === "denied" ? "#FFE5E5" : locating ? "#f0f0f0" : "#ffffff",
          border: `2px solid ${locPerm === "denied" ? "#FF3B3B" : "#111111"}`,
          borderRadius: "10px",
          boxShadow: "2px 2px 0 #111111",
          cursor: locating ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "box-shadow 0.1s, transform 0.1s",
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#BFFD00"; }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = locPerm === "denied" ? "#FFE5E5" : "#ffffff";
        }}
      >
        {locPerm === "denied"
          ? <MapPin size={20} color="#FF3B3B" />
          : <Navigation size={20} color="#111111" strokeWidth={locating ? 1.5 : 2} />
        }
      </button>

      {/* ── Nearby drops chip + list ──────────────────────────────────────── */}
      {nearbyDrops.length > 0 && (
        <>
          {showNearbyList && (
            <div
              onClick={() => setShowNearbyList(false)}
              style={{ position: "absolute", inset: 0, zIndex: 1000 }}
            />
          )}

          {showNearbyList && nearbyDrops.length > 1 && (
            <div style={{
              position: "absolute",
              bottom: "62px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1001,
              background: "#fff",
              border: "2px solid #111",
              borderRadius: 16,
              boxShadow: "4px 4px 0 #111",
              overflow: "hidden",
              minWidth: 220,
              maxWidth: 300,
            }}>
              <div style={{ padding: "10px 14px 8px", borderBottom: "1.5px solid #eee" }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  In claim range
                </p>
              </div>
              {nearbyDrops.map(({ drop, dist }) => (
                <button
                  key={String(drop.id)}
                  onClick={() => { setShowNearbyList(false); onDropClick(drop); }}
                  style={{
                    width: "100%", padding: "11px 14px",
                    background: "transparent", border: "none",
                    borderBottom: "1px solid #f0f0f0",
                    display: "flex", alignItems: "center", gap: 10,
                    cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f4f0"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>💰</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "#111" }}>
                      {formatG$(drop.amount)} G$
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: "#888" }}>
                      {Math.round(dist)}m away
                    </p>
                  </div>
                  <span style={{ color: "#888", fontSize: 14 }}>→</span>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              if (nearbyDrops.length === 1) {
                onDropClick(nearbyDrops[0].drop);
              } else {
                setShowNearbyList((v) => !v);
              }
            }}
            style={{
              position: "absolute",
              bottom: "12px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1001,
              background: "#BFFD00",
              border: "2px solid #111",
              borderRadius: 100,
              boxShadow: "2px 2px 0 #111",
              padding: "10px 20px",
              fontWeight: 900,
              fontSize: "13px",
              color: "#111",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 8,
              animation: "pulse 2s ease-in-out infinite",
            }}
          >
            💰
            {nearbyDrops.length === 1
              ? `${formatG$(nearbyDrops[0].drop.amount)} G$ — Claim now`
              : `${nearbyDrops.length} drops in range`}
            {nearbyDrops.length > 1 && (
              <span style={{ opacity: 0.6, fontSize: 11 }}>{showNearbyList ? "▲" : "▼"}</span>
            )}
          </button>
        </>
      )}

      {/* ── Zoom controls ─────────────────────────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          bottom: "100px",
          left: "12px",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          border: "2px solid #111111",
          borderRadius: "10px",
          overflow: "hidden",
          boxShadow: "2px 2px 0 #111111",
        }}
      >
        {[{ Icon: Plus, delta: 1 }, { Icon: Minus, delta: -1 }].map(({ Icon, delta }) => (
          <button
            key={delta}
            onClick={(e) => {
              e.stopPropagation();
              if (!mapRef.current) return;
              if (delta === 1) mapRef.current.zoomIn({ duration: 250 });
              else mapRef.current.zoomOut({ duration: 250 });
            }}
            style={{
              width: "36px",
              height: "36px",
              background: "#ffffff",
              border: "none",
              borderBottom: delta === 1 ? "1.5px solid #111111" : "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#BFFD00"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; }}
          >
            <Icon size={18} strokeWidth={2.5} color="#111111" />
          </button>
        ))}
      </div>
    </div>
  );
}
