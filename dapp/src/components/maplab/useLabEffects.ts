"use client";
import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";
import type { Drop, LatLng } from "@/types";
import { attachTreasure, type Treasure } from "./treasureLight";
import { MIDNIGHT_BUILDINGS } from "./midnight";
import { BUILDINGS_LAYER } from "@/components/map/buildings";
import { spinGlobe } from "./globe";
import { idleOrbit } from "./orbit";
import { addTerrain } from "./terrain";
import { lightForSun, phaseForSun, sunPosition } from "./sun";
import { skyFor } from "./brandStyle";
import type { LabSettings } from "./types";
import type { Quality } from "./quality";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The map lab's extras, applied to a loaded map: treasure light, the globe spin,
 * the real-sun sky and light, Midnight's building light, and terrain. Each one is its own effect with its
 * own cleanup, so switching one never disturbs the others. Lite phones get none
 * of the costly ones.
 */
export function useLabEffects(map: maplibregl.Map | null, { settings, quality, drops, userLoc }: {
  settings: LabSettings;
  quality: Quality;
  drops: Drop[];
  userLoc: LatLng | null;
}) {
  const lite = quality.tier === "lite";

  // Treasure light. Lite phones still get the gold halos (cheap, and the point
  // of the look); only the moving ripple is left out.
  const treasure = useRef<Treasure | null>(null);
  const dropsRef = useRef(drops);
  dropsRef.current = drops;
  useEffect(() => {
    if (!map || !settings.treasure) return;
    const t = attachTreasure(map, { animate: !lite && !reducedMotion() });
    t.update(dropsRef.current);
    treasure.current = t;
    return () => { t.destroy(); treasure.current = null; };
  }, [map, lite, settings.treasure]);
  useEffect(() => { treasure.current?.update(drops); }, [drops]);

  // Midnight lights its 3D buildings by height (the shared layer, restyled here
  // only, so other maps keep theirs).
  useEffect(() => {
    if (!map || settings.look !== "midnight" || !map.getLayer(BUILDINGS_LAYER)) return;
    try {
      map.setPaintProperty(BUILDINGS_LAYER, "fill-extrusion-color", MIDNIGHT_BUILDINGS.color);
      map.setPaintProperty(BUILDINGS_LAYER, "fill-extrusion-opacity", MIDNIGHT_BUILDINGS.opacity);
    } catch { /* map being replaced */ }
  }, [map, settings.look]);

  // The globe turns until the dive (or the first touch).
  useEffect(() => {
    if (!map || lite || !settings.globe || reducedMotion()) return;
    return spinGlobe(map);
  }, [map, lite, settings.globe]);

  // Idle drift at street level (a game's attract screen), never on Lite.
  useEffect(() => {
    if (!map || lite || !settings.drift || reducedMotion()) return;
    return idleOrbit(map);
  }, [map, lite, settings.drift]);

  // Sky and light from the real sun, refreshed every minute. Where: the hunter,
  // or the middle of the map until we know where they are.
  const locRef = useRef(userLoc);
  locRef.current = userLoc;
  useEffect(() => {
    if (!map || settings.sky !== "auto") return;
    const apply = () => {
      try {
        const c = locRef.current ?? { lat: map.getCenter().lat, lng: map.getCenter().lng };
        const sun = sunPosition(new Date(), c.lat, c.lng);
        // Midnight is always night in the sky; the sun still sets the light's direction.
        map.setSky(skyFor(settings.look === "midnight" ? "night" : phaseForSun(sun.altitude), { globe: settings.globe }));
        map.setLight(lightForSun(sun));
      } catch { /* map being replaced */ }
    };
    apply();
    const t = setInterval(apply, 60_000);
    return () => clearInterval(t);
  }, [map, settings.sky, settings.globe, settings.look, userLoc]);

  // Terrain (opt-in; never on Lite).
  useEffect(() => {
    if (!map || lite || !settings.terrain) return;
    return addTerrain(map);
  }, [map, lite, settings.terrain]);
}
