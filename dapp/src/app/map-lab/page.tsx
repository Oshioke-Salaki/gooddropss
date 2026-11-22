"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { ClaimSheet } from "@/components/ClaimSheet";
import { useLiveDrops } from "@/hooks/useLiveDrops";
import { useLandmarks } from "@/hooks/useLandmarks";
import { detectQuality, type Quality } from "@/components/maplab/quality";
import { LabPanel } from "@/components/maplab/LabPanel";
import { styleFor } from "@/components/maplab/styleFor";
import { useLabEffects } from "@/components/maplab/useLabEffects";
import { LAB_MAP, MIDNIGHT_MARKER_CSS, MIDNIGHT_SCOPE } from "@/components/maplab/midnightMarkers";
import type { LabSettings, LabStats } from "@/components/maplab/types";
import type { Drop, LatLng } from "@/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

// v2: Midnight became the default look; older saved choices start fresh.
const SETTINGS_KEY = "gd:maplab:settings:v2";
// Midnight, with the globe intro, treasure light and real-sun light on.
// Terrain costs extra downloads, so it starts off.
const DEFAULTS: LabSettings = {
  look: "midnight", buildings: true, buildingColor: "brand", sky: "auto",
  globe: true, treasure: true, drift: true, terrain: false,
};

/** Facing Africa, the whole Earth in view. */
const GLOBE_START = { center: [8, 9] as [number, number], zoom: 1.6 };
/** The dive from the globe to the hunter's street. */
const GLOBE_DIVE = { zoom: 16.5, pitch: 60, bearing: -20, duration: 5200, curve: 1.6 };

function loadSettings(): LabSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<LabSettings>;
    // Only known keys: older saved settings may carry removed options.
    return {
      look: saved.look === "night" || saved.look === "original" || saved.look === "midnight" ? saved.look : DEFAULTS.look,
      buildings: saved.buildings ?? DEFAULTS.buildings,
      buildingColor: saved.buildingColor === "classic" ? "classic" : "brand",
      sky: saved.sky ?? DEFAULTS.sky,
      globe: saved.globe ?? DEFAULTS.globe,
      treasure: saved.treasure ?? DEFAULTS.treasure,
      drift: saved.drift ?? DEFAULTS.drift,
      terrain: saved.terrain ?? DEFAULTS.terrain,
    };
  } catch { return DEFAULTS; }
}

const GLASS_LIGHT = "bg-white/95 backdrop-blur-md shadow-[0px_4px_20px_0px_#0000002E] text-heading";
// Midnight: dark glass with a faint blue edge, matching the map's own pills.
const GLASS_DARK = "bg-[rgba(8,12,40,0.72)] backdrop-blur-md shadow-[0_0_0_1px_rgba(111,148,255,0.22),0_8px_22px_rgba(0,0,0,0.45)] text-[#D6DEFF]";

/**
 * Map lab: the real GoodDrops map (same markers, location dot, controls and
 * claim sheet) with the next look layered on: the Midnight base map (a blue city
 * at night where only treasure is gold), a globe intro that dives to the
 * hunter's street, treasure light on drops, light that follows the real sun,
 * optional terrain, and the other base-map and building options.
 * Private: /map-lab, unlinked, not indexed.
 */
export default function MapLabPage() {
  const { drops, fetchDrops, markClaimed } = useLiveDrops();
  const { landmarks } = useLandmarks();
  const [quality, setQuality] = useState<Quality | null>(null);
  const [settings, setSettings] = useState<LabSettings | null>(null);
  const [style, setStyle] = useState<StyleSpecification | string | null>(null);
  const [stats, setStats] = useState<LabStats | null>(null);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [selected, setSelected] = useState<Drop | null>(null);
  const [panel, setPanel] = useState(false);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => { fetchDrops(); }, [fetchDrops]);
  useEffect(() => { setQuality(detectQuality()); setSettings(loadSettings()); }, []);

  // Resolve the base map for the chosen look (fetched once, then cached).
  const look = settings?.look;
  const globe = settings?.globe;
  useEffect(() => {
    if (!look || globe === undefined) return;
    let gone = false;
    setStyle(null);
    styleFor(look, { globe }).then((s) => { if (!gone) setStyle(s); });
    return () => { gone = true; };
  }, [look, globe]);

  const changeSettings = (s: LabSettings) => {
    setSettings(s);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  };

  const lab = useMemo(() => {
    if (!quality || !settings || !style) return null;
    return {
      style,
      brandBuildings: settings.buildingColor === "brand",
      buildings: settings.buildings,
      // "auto" is the real sun, applied by useLabEffects.
      sky: settings.sky === "auto" ? null : settings.sky,
      lite: quality.tier === "lite",
      globe: settings.globe,
      start: settings.globe ? GLOBE_START : undefined,
      firstFlight: settings.globe ? GLOBE_DIVE : undefined,
      onReady: setMap,
      onStats: setStats,
    };
  }, [quality, settings, style]);

  // A remount (base map, projection or buildings changed) replaces the map:
  // drop the old one at once so no effect touches it.
  const mapKey = settings ? `${settings.look}-${settings.globe}-${settings.buildings}-${settings.buildingColor}` : "";
  useEffect(() => { setMap(null); }, [mapKey]);

  useLabEffects(map, {
    settings: settings ?? DEFAULTS,
    quality: quality ?? { tier: "lite", reasons: [] },
    drops,
    userLoc,
  });

  const dark = settings?.look === "midnight";
  const GLASS = dark ? GLASS_DARK : GLASS_LIGHT;
  const tierName = quality ? { standard: "Standard", lite: "Lite" }[quality.tier] : null;
  const statusText = !tierName ? "Checking device…" : stats ? `${tierName} · ${stats.fps ? `${stats.fps} fps` : "idle"}` : tierName;

  return (
    <main className={`fixed inset-0 bg-[#0B0C29] font-sans overflow-hidden ${settings?.look === "midnight" ? MIDNIGHT_SCOPE : ""}`}>
      {settings?.look === "midnight" && <style>{MIDNIGHT_MARKER_CSS}</style>}
      {lab && settings ? (
        <div className={`absolute inset-0 ${LAB_MAP}`}>
          {/* Remount when the base map, projection or buildings change: all are set up at creation. */}
          <MapView
            key={mapKey}
            drops={drops}
            landmarks={landmarks}
            userLocation={userLoc}
            onUserLocation={setUserLoc}
            onDropClick={setSelected}
            lab={lab}
          />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm/none text-white/60">Loading map…</div>
      )}

      <div className="absolute top-0 inset-x-0 z-[1001] flex items-center justify-between gap-2 px-4 pt-[max(16px,env(safe-area-inset-top))] pointer-events-none">
        <Link href="/" className={`pointer-events-auto h-11 pl-3 pr-4 rounded-full ${GLASS} flex items-center gap-2 text-sm/none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}>
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          Map
        </Link>
        <div className="pointer-events-auto flex items-center gap-2 min-w-0">
          <span className={`h-11 px-4 rounded-full ${GLASS} flex items-center gap-2 text-sm/none min-w-0`} aria-live="polite">
            <span className={`shrink-0 ${dark ? "text-[#FFC23D]" : "text-brand"}`}>Map lab</span>
            <span className={`truncate tabular-nums ${dark ? "text-[#7C8BC8]" : "text-nav-muted"}`}>{statusText}</span>
          </span>
          <button type="button" onClick={() => setPanel(true)} aria-label="Map lab settings" disabled={!quality || !settings}
            className={`w-11 h-11 shrink-0 rounded-full ${GLASS} flex items-center justify-center cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}>
            <SlidersHorizontal className="w-[18px] h-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {panel && quality && settings && (
        <LabPanel settings={settings} onChange={changeSettings} quality={quality} stats={stats} onClose={() => setPanel(false)} />
      )}

      <ClaimSheet
        drop={selected}
        userLocation={userLoc}
        onClose={() => setSelected(null)}
        onSuccess={() => { if (selected) markClaimed(selected.id); setSelected(null); }}
        onHunt={() => setSelected(null)}
      />
    </main>
  );
}
