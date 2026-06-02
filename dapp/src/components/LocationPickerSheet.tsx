"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { Navigation, Search, X, MapPin } from "lucide-react";

const PickerMap = dynamic(() => import("./LocationPickerMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#e8e6e0",
      }}
    >
      <span style={{ fontSize: 36, animation: "bounce 1s infinite" }}>🗺️</span>
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    name?: string;
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
  };
}

interface FlyTarget {
  lat: number;
  lng: number;
  seq: number;
}

export interface Props {
  open: boolean;
  initialCenter: { lat: number; lng: number } | null;
  onConfirm: (lat: number, lng: number, placeName: string | null) => void;
  onClose: () => void;
}

// Default to Lagos if no location known
const DEFAULT_CENTER = { lat: 6.5244, lng: 3.3792 };

// ─── Component ────────────────────────────────────────────────────────────────

export function LocationPickerSheet({
  open,
  initialCenter,
  onConfirm,
  onClose,
}: Props) {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState<SearchResult[]>([]);
  const [searching, setSearching]   = useState(false);
  const [center, setCenter]         = useState(initialCenter ?? DEFAULT_CENTER);
  const [placeName, setPlaceName]   = useState<string | null>(null);
  const [geocoding, setGeocoding]   = useState(false);
  const [dragging, setDragging]     = useState(false);
  const [flyTarget, setFlyTarget]   = useState<FlyTarget | null>(null);
  const [locating, setLocating]     = useState(false);
  const [locErr, setLocErr]         = useState("");

  const searchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flySeq        = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Reset on open ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const c = initialCenter ?? DEFAULT_CENTER;
    setQuery("");
    setResults([]);
    setCenter(c);
    setPlaceName(null);
    setDragging(false);
    setFlyTarget(null);
    reverseGeocode(c.lat, c.lng);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search (debounced 400ms) ──────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const q = query.trim();
    if (q.length < 3) { setResults([]); setSearching(false); return; }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`,
          { headers: { "Accept-Language": "en" } }
        );
        const data: SearchResult[] = await res.json();
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query]);

  // ── Reverse geocode ───────────────────────────────────────────────────────────
  const reverseGeocode = useCallback((lat: number, lng: number) => {
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    setGeocoding(true);
    geocodeTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
          { headers: { "Accept-Language": "en" } }
        );
        const data = await res.json();
        const a = data.address ?? {};
        const area   = a.suburb ?? a.neighbourhood ?? a.village ?? a.city_district ?? "";
        const city   = a.city ?? a.town ?? a.county ?? a.state ?? "";
        const country = a.country ?? "";
        const parts = [area, city, country].filter(Boolean);
        setPlaceName(parts.slice(0, 2).join(", ") || city || country || null);
      } catch {
        setPlaceName(null);
      } finally {
        setGeocoding(false);
      }
    }, 350);
  }, []);

  // ── Map center change ─────────────────────────────────────────────────────────
  const handleCenterChange = useCallback((lat: number, lng: number) => {
    setCenter({ lat, lng });
    reverseGeocode(lat, lng);
  }, [reverseGeocode]);

  // ── Select search result ──────────────────────────────────────────────────────
  function selectResult(r: SearchResult) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    setQuery("");
    setResults([]);
    searchInputRef.current?.blur();
    setFlyTarget({ lat, lng, seq: ++flySeq.current });
  }

  // ── My location ───────────────────────────────────────────────────────────────
  function goToMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    setLocErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setFlyTarget({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          seq: ++flySeq.current,
        });
      },
      () => {
        setLocating(false);
        setLocErr("Couldn't get location");
        setTimeout(() => setLocErr(""), 3000);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // ── Format search result label ────────────────────────────────────────────────
  function formatResult(r: SearchResult) {
    const a = r.address;
    const primary = a.name ?? a.road ?? r.display_name.split(",")[0];
    const secondary = [
      a.suburb ?? a.neighbourhood ?? "",
      a.city ?? a.town ?? a.village ?? a.state ?? "",
      a.country ?? "",
    ]
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");
    return { primary, secondary };
  }

  const showResults = results.length > 0 || searching;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        animate={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        transition={{ duration: 0.2 }}
        style={{
          position: "fixed", inset: 0, zIndex: 1001,
          backgroundColor: "rgba(17,17,17,0.6)",
          backdropFilter: "blur(2px)",
          opacity: 0, pointerEvents: "none",
        }}
      />

      {/* Full-screen sheet */}
      <motion.div
        animate={{ y: open ? 0 : "100%" }}
        initial={{ y: "100%" }}
        transition={{ type: "spring", damping: 34, stiffness: 420 }}
        style={{
          position: "fixed", inset: 0, zIndex: 1002,
          background: "#f5f4f0",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: "14px 16px 12px",
            borderBottom: "2px solid #111",
            display: "flex", alignItems: "center", gap: 12,
            background: "#f5f4f0", flexShrink: 0,
          }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 900, fontSize: 17, margin: 0 }}>Choose drop location</p>
            <p style={{ fontSize: 12, color: "#888", margin: 0, marginTop: 2 }}>
              Pan the map or search for a place
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: "50%",
              border: "2px solid #111", background: "transparent",
              fontWeight: 800, fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Search bar ─────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: showResults ? "none" : "2px solid #111",
            background: "#f5f4f0", flexShrink: 0, position: "relative", zIndex: 20,
          }}
        >
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "#fff",
              border: "2px solid #111",
              borderRadius: showResults ? "12px 12px 0 0" : 12,
              padding: "9px 12px",
              boxShadow: showResults ? "none" : "2px 2px 0 #111",
            }}
          >
            <Search size={16} color={searching ? "#aaa" : "#888"} style={{ flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a place, street or city…"
              style={{
                flex: 1, border: "none", outline: "none",
                background: "transparent", fontSize: 14,
                fontFamily: "inherit", fontWeight: 500,
              }}
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setResults([]); }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 0, display: "flex", alignItems: "center",
                }}
              >
                <X size={16} color="#888" />
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          <AnimatePresence>
            {showResults && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                style={{
                  background: "#fff",
                  border: "2px solid #111",
                  borderTop: "1.5px solid #ddd",
                  borderRadius: "0 0 12px 12px",
                  boxShadow: "2px 3px 0 #111",
                  overflow: "hidden",
                }}
              >
                {searching ? (
                  <div style={{ padding: "12px 14px", color: "#888", fontSize: 13 }}>
                    Searching…
                  </div>
                ) : (
                  results.map((r, i) => {
                    const { primary, secondary } = formatResult(r);
                    return (
                      <button
                        key={r.place_id}
                        onClick={() => selectResult(r)}
                        style={{
                          width: "100%", padding: "11px 14px", textAlign: "left",
                          background: "transparent", border: "none",
                          borderTop: i > 0 ? "1px solid #f0f0f0" : "none",
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 10,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f4f0"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <MapPin size={14} color="#888" style={{ flexShrink: 0 }} />
                        <div>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#111", lineHeight: 1.3 }}>
                            {primary}
                          </p>
                          {secondary && (
                            <p style={{ margin: 0, fontSize: 12, color: "#888", marginTop: 1 }}>
                              {secondary}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Map area ────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <PickerMap
            initialCenter={initialCenter ?? DEFAULT_CENTER}
            flyTarget={flyTarget}
            onCenterChange={handleCenterChange}
            onDragChange={setDragging}
          />

          {/* Center pin — stays fixed at map midpoint, lifts when dragging */}
          <div
            style={{
              position: "absolute",
              top: "50%", left: "50%",
              transform: `translate(-50%, ${dragging ? "-120%" : "-100%"})`,
              transition: "transform 0.15s ease",
              zIndex: 1000,
              pointerEvents: "none",
              display: "flex", flexDirection: "column", alignItems: "center",
            }}
          >
            {/* Pin circle */}
            <div
              style={{
                width: 46, height: 46,
                background: "#BFFD00",
                border: "2.5px solid #111",
                borderRadius: "50%",
                boxShadow: dragging
                  ? "4px 4px 0 #111"
                  : "2px 2px 0 #111",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20,
                transition: "box-shadow 0.15s ease",
              }}
            >
              💰
            </div>
            {/* Pin stem */}
            <div
              style={{
                width: 0, height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "10px solid #111",
                marginTop: -1,
              }}
            />
          </div>

          {/* My location button */}
          <button
            onClick={goToMyLocation}
            title="Go to my location"
            style={{
              position: "absolute", bottom: 16, right: 12, zIndex: 1000,
              width: 44, height: 44,
              background: locating ? "#E8E6E0" : "#fff",
              border: "2px solid #111",
              borderRadius: 10,
              boxShadow: "2px 2px 0 #111",
              cursor: locating ? "wait" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "inherit",
              transition: "box-shadow 0.1s, transform 0.1s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "0 0 0 #111";
              e.currentTarget.style.transform = "translate(2px,2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "2px 2px 0 #111";
              e.currentTarget.style.transform = "translate(0,0)";
            }}
          >
            <Navigation size={20} color="#111" strokeWidth={locating ? 1.5 : 2} />
          </button>

          {/* Location error tooltip */}
          {locErr && (
            <div
              style={{
                position: "absolute", bottom: 68, right: 12, zIndex: 1000,
                background: "#111", color: "#fff",
                fontSize: 12, fontWeight: 600,
                padding: "6px 10px", borderRadius: 8,
                whiteSpace: "nowrap", fontFamily: "inherit",
                pointerEvents: "none",
              }}
            >
              {locErr}
            </div>
          )}
        </div>

        {/* ── Footer: address + confirm ────────────────────────────────────────── */}
        <div
          style={{
            padding: "12px 14px 28px",
            borderTop: "2px solid #111",
            background: "#f5f4f0", flexShrink: 0,
          }}
        >
          {/* Current resolved address */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              marginBottom: 12, minHeight: 40,
            }}
          >
            <div
              style={{
                width: 36, height: 36, borderRadius: 8,
                background: geocoding ? "#e8e6e0" : "#BFFD00",
                border: "2px solid #111",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.2s",
              }}
            >
              <MapPin size={18} color="#111" strokeWidth={geocoding ? 1.5 : 2} />
            </div>
            <div style={{ minWidth: 0 }}>
              {geocoding ? (
                <>
                  <div style={{ height: 14, width: 140, background: "#ddd", borderRadius: 4, marginBottom: 4 }} />
                  <div style={{ height: 11, width: 90, background: "#eee", borderRadius: 4 }} />
                </>
              ) : (
                <>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14, lineHeight: 1.3, color: "#111" }}>
                    {placeName ?? "Unknown location"}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "#888", fontFamily: "monospace", marginTop: 1 }}>
                    {center.lat.toFixed(5)}°, {center.lng.toFixed(5)}°
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Confirm button */}
          <button
            onClick={() => onConfirm(center.lat, center.lng, placeName)}
            style={{
              width: "100%", padding: "15px",
              background: "#BFFD00", color: "#111",
              border: "2.5px solid #111",
              boxShadow: "3px 3px 0 #111",
              borderRadius: 14,
              fontWeight: 900, fontSize: 16,
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "box-shadow 0.1s, transform 0.1s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "1px 1px 0 #111";
              e.currentTarget.style.transform = "translate(2px,2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "3px 3px 0 #111";
              e.currentTarget.style.transform = "translate(0,0)";
            }}
          >
            <MapPin size={18} color="#111" />
            <span>Drop here</span>
          </button>
        </div>
      </motion.div>
    </>
  );
}
