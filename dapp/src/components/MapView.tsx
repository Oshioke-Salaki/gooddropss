"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { Navigation, MapPin, Plus, Minus } from "lucide-react";
import { formatG$, gpsToDeg, getDropRarity, RARITY, isFlashDrop } from "@/lib/utils";
import { CLAIM_RADIUS_M } from "@/lib/contracts";
import type { Drop, LatLng } from "@/types";
import { DROP_STATUS } from "@/types";

let mountCount = 0;

type LocPerm = "unknown" | "prompt" | "granted" | "denied";

// ── Custom drop icons (rarity-aware, dark theme) ─────────────────────────────

function makeDropIcon(drop: Drop): L.DivIcon {
  const active =
    drop.status === DROP_STATUS.Active &&
    drop.expiry > Math.floor(Date.now() / 1000);

  if (!active) {
    const isClaimed = drop.status === DROP_STATUS.Claimed;
    return L.divIcon({
      className: "",
      html: `<div style="
        width:36px;height:36px;
        background:#1a1a2a;
        border:1.5px solid #333;
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-weight:700;font-size:14px;color:#444;
        cursor:pointer;font-family:'Space Grotesk',sans-serif;
        user-select:none;
      ">${isClaimed ? "✓" : "↩"}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  const flash      = isFlashDrop(drop);
  const isCampaign = /^\[C:[^\]]+\]/.test(drop.hint);
  const isChain    = /^\[CH:[^\]]+\]/.test(drop.hint);
  const rarity     = getDropRarity(drop.amount);
  const r          = RARITY[rarity];
  const label      = formatG$(drop.amount);

  if (flash) {
    return L.divIcon({
      className: "pin-flash",
      html: `<div style="
        width:52px;height:52px;
        background:#FF6400;
        border:2.5px solid rgba(0,0,0,0.5);
        border-radius:50%;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-weight:900;font-size:10px;color:#fff;
        cursor:pointer;
        font-family:'Space Grotesk',sans-serif;
        user-select:none;gap:1px;
      "><span style="font-size:13px;line-height:1;">⚡</span><span>${label}</span></div>`,
      iconSize: [52, 52],
      iconAnchor: [26, 26],
    });
  }

  // Chain drops: linked pin with 🔗 icon
  if (isChain) {
    return L.divIcon({
      className: r.animClass,
      html: `<div style="
        position:relative;
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
      ">
        <span style="font-size:13px;line-height:1;">🔗</span>
        <span>${label}</span>
      </div>`,
      iconSize: [54, 54],
      iconAnchor: [27, 27],
    });
  }

  // Campaign drops get a star badge and double-ring border to stand out
  if (isCampaign) {
    return L.divIcon({
      className: r.animClass,
      html: `<div style="
        position:relative;
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
      ">
        <span style="font-size:11px;line-height:1;">⭐</span>
        <span>${label}</span>
      </div>`,
      iconSize: [54, 54],
      iconAnchor: [27, 27],
    });
  }

  return L.divIcon({
    className: r.animClass,
    html: `<div style="
      width:48px;height:48px;
      background:${r.color};
      border:2px solid rgba(0,0,0,0.5);
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-weight:900;font-size:11px;color:${r.textColor};
      cursor:pointer;
      font-family:'Space Grotesk',sans-serif;
      user-select:none;
    ">${label}</div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

// ── Claim radius circle ──────────────────────────────────────────────────────

function ClaimRadiusCircle({ center }: { center: LatLng }) {
  const map = useMap();
  useEffect(() => {
    const circle = L.circle([center.lat, center.lng], {
      radius: CLAIM_RADIUS_M,
      color: "#3B82F6",
      fillColor: "#3B82F6",
      fillOpacity: 0.07,
      weight: 1.5,
      dashArray: "6 5",
      interactive: false,
    });
    map.addLayer(circle);
    return () => { map.removeLayer(circle); };
  }, [center.lat, center.lng, map]);
  return null;
}

// ── Map utilities inside MapContainer ───────────────────────────────────────

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

// Watches position continuously. Only mounted after permission is confirmed granted.
function LocationWatcher({ onLocation }: { onLocation: (loc: LatLng) => void }) {
  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => onLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [onLocation]);

  return null;
}

// ── Cluster layer ────────────────────────────────────────────────────────────
// Manages a leaflet.markercluster group whose lifecycle mirrors the drops array.

function ClusterLayer({
  drops,
  onDropClick,
}: {
  drops: Drop[];
  onDropClick: (drop: Drop) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const group = (L as any).markerClusterGroup({
      maxClusterRadius: 56,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          className: "pin-pulse-uncommon",
          html: `<div style="
            width:46px;height:46px;
            background:#BFFD00;
            border:2px solid rgba(0,0,0,0.5);
            border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            font-weight:900;font-size:14px;color:#111;
            font-family:'Space Grotesk',sans-serif;
          ">${count}</div>`,
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        });
      },
    });

    drops.forEach((drop) => {
      const marker = L.marker(
        [gpsToDeg(drop.lat), gpsToDeg(drop.lng)],
        { icon: makeDropIcon(drop) }
      );
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onDropClick(drop);
      });
      group.addLayer(marker);
    });

    map.addLayer(group);
    return () => { map.removeLayer(group); };
  }, [drops, map, onDropClick]);

  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  drops: Drop[];
  onDropClick: (drop: Drop) => void;
  userLocation: LatLng | null;
  onUserLocation: (loc: LatLng) => void;
}

export default function MapView({ drops, onDropClick, userLocation, onUserLocation }: Props) {
  const [mapKey] = useState(() => ++mountCount);
  const mapRef = useRef<L.Map | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateErr, setLocateErr] = useState("");
  const [locPerm, setLocPerm] = useState<LocPerm>("unknown");

  // Check permission state, trigger request when appropriate, watch for changes.
  // Mirrors goyin-front's navigator.permissions.query pattern.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    function doRequest() {
      // Fast low-accuracy fix first, then the watcher handles high-accuracy updates
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          onUserLocation(loc);
          setLocPerm("granted");
          if (mapRef.current) mapRef.current.flyTo([loc.lat, loc.lng], 16, { duration: 1.2 });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setLocPerm("denied");
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 }
      );
    }

    if (!navigator.permissions) {
      // Older Safari — call directly, which triggers the browser dialog
      doRequest();
      return;
    }

    navigator.permissions.query({ name: "geolocation" }).then((result) => {
      setLocPerm(result.state as LocPerm);

      if (result.state === "granted" || result.state === "prompt") {
        // "granted" → silent success; "prompt" → triggers the browser permission dialog
        doRequest();
      }

      result.onchange = () => {
        const s = result.state as LocPerm;
        setLocPerm(s);
        if (s === "granted") {
          setLocateErr("");
          doRequest();
        }
      };
    }).catch(() => doRequest()); // fallback: just try
  }, [onUserLocation]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (mapRef.current) mapRef.current.flyTo([loc.lat, loc.lng], 17, { duration: 1.2 });
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
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 }
    );
  }, [onUserLocation]);

  function flyToUser() {
    if (locPerm === "denied") {
      setLocateErr("Location denied — enable in browser settings & reload");
      setTimeout(() => setLocateErr(""), 5_000);
      return;
    }

    // Already have a fix — just pan to it
    if (mapRef.current && userLocation) {
      mapRef.current.flyTo([userLocation.lat, userLocation.lng], 17, { duration: 1.2 });
      return;
    }

    requestLocation();
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MapContainer
        key={mapKey}
        center={[20, 0]}
        zoom={3}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
      >
        <TileLayer
          url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={20}
        />

        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={L.divIcon({
              className: "",
              html: `
                <div style="position:relative;width:24px;height:24px;">
                  <div class="user-loc-pulse" style="
                    position:absolute;
                    inset:-10px;
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
                </div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            })}
            zIndexOffset={1000}
          />
        )}

        {userLocation && <ClaimRadiusCircle center={userLocation} />}
        <ClusterLayer drops={drops} onDropClick={onDropClick} />

        {/* Watch continuously once permission is confirmed — avoids re-triggering the dialog */}
        {locPerm === "granted" && <LocationWatcher onLocation={onUserLocation} />}
        <MapRefCapture mapRef={mapRef} />
      </MapContainer>

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
              if (mapRef.current) mapRef.current.setZoom(mapRef.current.getZoom() + delta);
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
