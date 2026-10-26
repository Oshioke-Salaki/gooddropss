"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { CornerUpRight, MapPin, Move, Search, X, Map as MapIcon } from "lucide-react";
import { MapZoomControls } from "@/components/MapZoomControls";
import { MyLocationButton } from "@/components/MyLocationButton";
import type maplibregl from "maplibre-gl";
import { landmarkMeta } from "@/lib/landmarks";
import {
  getPositionRobust,
  geoErrorMessage,
  type GeoFail,
} from "@/lib/geolocate";
import type { Landmark } from "@/types";

const PickerMap = dynamic(() => import("./LocationPickerMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-surface">
      <span className="w-14 h-14 rounded-full bg-white text-nav-muted flex items-center justify-center animate-pulse">
        <MapIcon className="w-6 h-6" strokeWidth={1.75} />
      </span>
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
  currentLocation?: { lat: number; lng: number } | null;
  onConfirm: (lat: number, lng: number, placeName: string | null) => void;
  onClose: () => void;
  /** Our curated landmarks — shown on the map and matched by the search. */
  landmarks?: Landmark[];
  /** Keep the pin locked onto `currentLocation` (and follow it as GPS sharpens)
   *  until the user drags — used for "pin my shop where I'm standing". */
  followLocation?: boolean;
  /** Optional glyph inside the map pin (e.g. a <Store/> icon for a shop). The
   *  drop picker passes nothing — the pin artwork speaks for itself. */
  pinIcon?: React.ReactNode;
  /** Confirm-button label (default "Drop here"; e.g. "Pin my shop here"). */
  confirmLabel?: string;
}

// Default to Lagos if no location known
const DEFAULT_CENTER = { lat: 6.5244, lng: 3.3792 };

// ─── Component ────────────────────────────────────────────────────────────────

export function LocationPickerSheet({
  open,
  initialCenter,
  currentLocation,
  onConfirm,
  onClose,
  landmarks = [],
  followLocation = false,
  pinIcon,
  confirmLabel = "Drop here",
}: Props) {
  const [query, setQuery] = useState("");
  const [showFollowHint, setShowFollowHint] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [center, setCenter] = useState(initialCenter ?? DEFAULT_CENTER);
  const [placeName, setPlaceName] = useState<string | null>(null);
  // The bar reads as two lines ("Algeria Cresent, TheBuidl" over "Barnawa").
  // Presentation only — `placeName` remains what onConfirm receives.
  const [placeSub, setPlaceSub] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [locating, setLocating] = useState(false);
  // Handed up by the picker map once it's ready, so MapZoomControls can drive it.
  const [pickerMap, setPickerMap] = useState<maplibregl.Map | null>(null);
  const [locErr, setLocErr] = useState("");

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flySeq = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // In followLocation mode: true once the user has manually moved the map, so we
  // stop yanking the pin back to the live GPS position.
  const userMovedRef = useRef(false);

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
    userMovedRef.current = false;
    setShowFollowHint(followLocation);
    reverseGeocode(c.lat, c.lng);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Follow the live location (merchant "pin my shop") ────────────────────────
  // Keep the pin on currentLocation and re-centre as GPS sharpens — so the pin
  // converges onto the real spot instead of stranding at the first rough fix —
  // until the user drags the map, after which their choice is respected.
  useEffect(() => {
    if (!open || !followLocation || userMovedRef.current || !currentLocation)
      return;
    setFlyTarget({
      lat: currentLocation.lat,
      lng: currentLocation.lng,
      seq: ++flySeq.current,
    });
  }, [open, followLocation, currentLocation]);

  // ── Search (debounced 400ms) ──────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`,
          { headers: { "Accept-Language": "en" } },
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
        setPlaceSub(parts[1] ?? null);
      } catch {
        setPlaceName(null);
        setPlaceSub(null);
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
    const { primary, secondary } = formatResult(r);
    setPlaceName(primary);
    setPlaceSub(secondary || null);
    setFlyTarget({ lat, lng, seq: ++flySeq.current });
  }

  // ── My location ───────────────────────────────────────────────────────────────
  function goToMyLocation() {
    setLocErr("");

    // Prefer the live-tracked position from the main map — it's already
    // high-accuracy from watchPosition and requires no async call.
    if (currentLocation) {
      setFlyTarget({ lat: currentLocation.lat, lng: currentLocation.lng, seq: ++flySeq.current });
      return;
    }

    // Fallback: fetch once (no live position available yet). A single GPS read
    // times out indoors, so use the robust watch-based getter, which resolves on
    // the first fix the OS produces (often a quick network triangulation).
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setLocating(true);
    getPositionRobust()
      .then((pos) => {
        setLocating(false);
        setFlyTarget({ lat: pos.coords.latitude, lng: pos.coords.longitude, seq: ++flySeq.current });
      })
      .catch((e: GeoFail) => {
        setLocating(false);
        setLocErr(geoErrorMessage(e?.kind ?? "unavailable", "drop"));
        setTimeout(() => setLocErr(""), 5000);
      });
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

  // ── Our landmarks matched by name (shown above the OSM results) ──────────────
  const landmarkResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return landmarks
      .filter((l) => l.status === "active" && l.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, landmarks]);

  function selectLandmark(l: Landmark) {
    setQuery("");
    setResults([]);
    searchInputRef.current?.blur();
    setPlaceName(l.name);
    setPlaceSub(landmarkMeta(l.category).label);
    setFlyTarget({ lat: l.lat, lng: l.lng, seq: ++flySeq.current });
  }

  const showResults = landmarkResults.length > 0 || results.length > 0 || searching;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        animate={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[1450] bg-[#0000000A] backdrop-blur-md"
        style={{ opacity: 0, pointerEvents: "none" }}
      />

      {/* Full-screen sheet. The map owns the whole surface and every control
          floats on it — no header, no footer bar. */}
      <motion.div
        animate={{ y: open ? 0 : "100%" }}
        initial={{ y: "100%" }}
        transition={{ type: "spring", damping: 34, stiffness: 420 }}
        className="fixed inset-0 z-[1451] overflow-hidden bg-nav font-sans"
      >
        <PickerMap
          initialCenter={initialCenter ?? DEFAULT_CENTER}
          flyTarget={flyTarget}
          onCenterChange={handleCenterChange}
          onDragChange={setDragging}
          onUserInteract={() => {
            userMovedRef.current = true;
            setShowFollowHint(false);
          }}
          landmarks={landmarks}
          onMapReady={setPickerMap}
        />

        {/* ── Search ─────────────────────────────────────────────────────────
            Same pill as the map page, same corner, same 320px. */}
        <div className="absolute left-4 top-4 z-20 w-[calc(100%-32px)] lg:left-[60px] lg:top-5 lg:w-[320px]">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search locations..."
              aria-label="Search locations"
              className="w-full rounded-full bg-surface py-5 pl-6 pr-14 text-sm/none text-heading placeholder:text-nav-muted outline-none focus:ring-2 focus:ring-brand/30 motion-safe:transition-shadow"
            />
            <button
              type="button"
              onClick={() => {
                if (query) { setQuery(""); setResults([]); }
                else searchInputRef.current?.focus();
              }}
              aria-label={query ? "Clear search" : "Search"}
              className="absolute right-6 top-1/2 -translate-y-1/2 cursor-pointer text-black"
            >
              {query ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </button>
          </div>

          <AnimatePresence>
            {showResults && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 z-30 mt-2 max-h-[50vh] w-full overflow-y-auto rounded-3xl bg-white py-4 shadow-[0px_0px_12px_0px_#0000000A]"
              >
                {/* Our curated places first — a dropper knows these names */}
                {landmarkResults.map((l) => {
                  const meta = landmarkMeta(l.category);
                  return (
                    <button
                      key={`lm-${l.id}`}
                      onClick={() => selectLandmark(l)}
                      className="flex w-full cursor-pointer items-center gap-x-4 px-6 py-3 text-left motion-safe:transition-colors hover:bg-surface"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-base leading-none">
                        {meta.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm/none text-heading">{l.name}</span>
                        <span className="mt-2 block text-xs/none text-nav-muted">
                          Saved place · {meta.label}
                        </span>
                      </span>
                    </button>
                  );
                })}

                {searching ? (
                  <p className="px-6 py-3 text-sm/none text-nav-muted">Searching…</p>
                ) : (
                  results.map((r) => {
                    const { primary, secondary } = formatResult(r);
                    return (
                      <button
                        key={r.place_id}
                        onClick={() => selectResult(r)}
                        className="flex w-full cursor-pointer items-center gap-x-4 px-6 py-3 text-left motion-safe:transition-colors hover:bg-surface"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface">
                          <MapPin size={16} className="text-heading" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm/none text-heading">{primary}</span>
                          {secondary && (
                            <span className="mt-2 block truncate text-xs/none text-nav-muted">
                              {secondary}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Centre pin ────────────────────────────────────────────────────
            Anchored by its TIP, which is the point being chosen. Dragging lifts
            it and deepens the shadow rather than scaling it — growing the pin
            would move the tip away from the coordinate it represents. */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-[1000]"
          style={{
            transform: `translate(-50%, ${dragging ? "-108%" : "-100%"})`,
            transition: "transform 0.15s ease",
            filter: dragging
              ? "drop-shadow(0 10px 10px rgba(0,0,0,0.5))"
              : "drop-shadow(0 4px 6px rgba(0,0,0,0.4))",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/drop-location-pin-white.svg"
            alt=""
            width={34}
            height={55}
            className="h-[55px] w-[34px] select-none"
          />
          {pinIcon && (
            <span className="absolute left-1/2 top-[11px] -translate-x-1/2 text-sm leading-none">
              {pinIcon}
            </span>
          )}
        </div>

        {/* Follow-mode reassurance — the pin auto-locks onto the merchant's live
            position and refines as GPS sharpens; this explains the movement so it
            doesn't read as a glitch, and invites a manual nudge. */}
        {showFollowHint && (
          <div className="pointer-events-none absolute left-1/2 top-24 z-[1000] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[#FFFFFF33] px-4 py-2 text-xs/none text-white backdrop-blur-[20px]">
            <span className="inline-block h-2 w-2 rounded-full bg-brand" />
            Locking onto your location — drag to adjust
          </div>
        )}

        {/* ── Map controls — the SAME components the map page uses ─────────── */}
        <div className="absolute bottom-5 left-5 z-[1000] flex flex-col items-start gap-3 lg:bottom-[60px] lg:left-[60px]">
          <MapZoomControls map={pickerMap} />
          <MyLocationButton
            onClick={goToMyLocation}
            locating={locating}
            error={locErr || undefined}
          />
        </div>

        {/* ── Confirm ────────────────────────────────────────────────────────
            While the map is moving the label would be stale, so the hint takes
            over — it's also the only moment the drag gesture needs explaining.
            Settled, the bar names the spot and offers the action. */}
        {dragging ? (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 whitespace-nowrap text-white lg:bottom-[60px]">
            <Move className="h-5 w-5 shrink-0" />
            <span className="text-base/none italic">Drag and click to select a drop location</span>
          </div>
        ) : (
          <div className="absolute bottom-5 left-1/2 z-[1000] flex w-[calc(100%-40px)] -translate-x-1/2 items-center justify-center lg:bottom-[60px] lg:w-auto">
            <div className="flex min-w-0 items-center gap-x-4 rounded-full bg-white p-2">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface">
                <CornerUpRight className="h-5 w-5 text-heading" />
              </span>

              <span className="hidden min-w-0 flex-1 flex-col gap-y-1.5 sm:flex">
                <span className="truncate text-base/none text-heading">
                  {/* Coordinates stand in while the reverse geocode is in flight
                      or has nothing — the bar must never be unactionable. */}
                  {placeName ?? `${center.lat.toFixed(5)}°, ${center.lng.toFixed(5)}°`}
                </span>
                <span className="truncate text-sm/none text-nav-muted">
                  {geocoding
                    ? "Finding this place…"
                    : (placeSub ?? `${center.lat.toFixed(5)}°, ${center.lng.toFixed(5)}°`)}
                </span>
              </span>

              <button
                onClick={() => onConfirm(center.lat, center.lng, placeName)}
                className="flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand px-8 py-4 text-base/none text-white motion-safe:transition-opacity hover:opacity-90"
              >
                <MapPin size={18} />
                <span>{confirmLabel}</span>
              </button>
            </div>

            <button
              onClick={onClose}
              aria-label="Cancel"
              className="ml-4 shrink-0 cursor-pointer rounded-full bg-white p-[6px] text-nav-active motion-safe:transition-colors hover:bg-surface"
            >
              <X size={20} />
            </button>
          </div>
        )}

      </motion.div>
    </>
  );
}
