"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { ClaimSheet } from "@/components/ClaimSheet";
import { useLiveDrops } from "@/hooks/useLiveDrops";
import { useLandmarks } from "@/hooks/useLandmarks";
import { detectQuality, type Quality } from "@/components/maplab/quality";
import { LabPanel } from "@/components/maplab/LabPanel";
import { styleFor } from "@/components/maplab/styleFor";
import { phaseForHour } from "@/components/maplab/brandStyle";
import type { LabSettings, LabStats } from "@/components/maplab/types";
import type { Drop, LatLng } from "@/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const SETTINGS_KEY = "gd:maplab:settings";
// The look picked in review: the original base map with brand-blue buildings.
const DEFAULTS: LabSettings = { look: "original", buildings: true, buildingColor: "brand", sky: "auto" };

function loadSettings(): LabSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<LabSettings>;
    // Only known keys: older saved settings may carry removed options.
    return {
      look: saved.look ?? DEFAULTS.look,
      buildings: saved.buildings ?? DEFAULTS.buildings,
      buildingColor: saved.buildingColor === "classic" ? "classic" : "brand",
      sky: saved.sky ?? DEFAULTS.sky,
    };
  } catch { return DEFAULTS; }
}

const GLASS = "bg-white/95 backdrop-blur-md shadow-[0px_4px_20px_0px_#0000002E]";

/**
 * Map lab: the real GoodDrops map (same markers, location dot, controls and
 * claim sheet) with the next look layered on: the GoodDrops Night base map,
 * gradient 3D buildings and a sky that follows the local time. Private:
 * /map-lab, unlinked, not indexed.
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

  useEffect(() => { fetchDrops(); }, [fetchDrops]);
  useEffect(() => { setQuality(detectQuality()); setSettings(loadSettings()); }, []);

  // Resolve the base map for the chosen look (fetched once, then cached).
  const look = settings?.look;
  useEffect(() => {
    if (!look) return;
    let gone = false;
    setStyle(null);
    styleFor(look).then((s) => { if (!gone) setStyle(s); });
    return () => { gone = true; };
  }, [look]);

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
      sky: settings.sky === "auto" ? phaseForHour(new Date().getHours()) : settings.sky,
      lite: quality.tier === "lite",
      onStats: setStats,
    };
  }, [quality, settings, style]);

  const tierName = quality ? { standard: "Standard", lite: "Lite" }[quality.tier] : null;
  const statusText = !tierName ? "Checking device…" : stats ? `${tierName} · ${stats.fps ? `${stats.fps} fps` : "idle"}` : tierName;

  return (
    <main className="fixed inset-0 bg-[#0B0C29] font-sans overflow-hidden">
      {lab && settings ? (
        <div className="absolute inset-0">
          {/* Remount when the base map or buildings change: both are set up at creation. */}
          <MapView
            key={`${settings.look}-${settings.buildings}-${settings.buildingColor}`}
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
        <Link href="/" className={`pointer-events-auto h-11 pl-3 pr-4 rounded-full ${GLASS} flex items-center gap-2 text-sm/none text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}>
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          Map
        </Link>
        <div className="pointer-events-auto flex items-center gap-2 min-w-0">
          <span className={`h-11 px-4 rounded-full ${GLASS} flex items-center gap-2 text-sm/none text-heading min-w-0`} aria-live="polite">
            <span className="text-brand shrink-0">Map lab</span>
            <span className="text-nav-muted truncate tabular-nums">{statusText}</span>
          </span>
          <button type="button" onClick={() => setPanel(true)} aria-label="Map lab settings" disabled={!quality || !settings}
            className={`w-11 h-11 shrink-0 rounded-full ${GLASS} flex items-center justify-center text-heading cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}>
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
