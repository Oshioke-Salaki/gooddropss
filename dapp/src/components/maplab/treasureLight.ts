// Treasure light: on a map drawn entirely in cool blues, G$ is the only warm
// colour, so the eye goes straight to it.
//
//   • Every live drop: a soft gold bloom on the ground, sized by rarity, with a
//     slow sonar ripple at street level. From the globe, drops read as gold
//     sparks.
//   • Rare and legendary drops also get a beam of light (see beams.ts).
//
// `treasureData` is pure (unit-tested); `attachTreasure` wires it to a map.

import type maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import { DROP_STATUS, type Drop } from "@/types";
import { getDropRarity, gpsToDeg, type DropRarity } from "@/lib/utils";
import { attachBeams } from "./beams";

export const GOLD = { bloom: "#FF9F00", halo: "#FFB400", core: "#FFE7A3" } as const;

/** Bloom size per rarity. */
export const TREASURE: Record<DropRarity, { scale: number }> = {
  common: { scale: 0.7 },
  uncommon: { scale: 0.85 },
  rare: { scale: 1.15 },
  legendary: { scale: 1.6 },
};

/** `phase` (0..1) staggers each drop's ripple, so a busy area shimmers instead of pulsing in unison. */
type Props = { rarity: DropRarity; scale: number; phase: number };

/** Golden-ratio spread: neighbouring ids land far apart in the cycle. */
const phaseOf = (id: bigint) => (Number(id % 100_000n) * 0.618_033_988_75) % 1;

/** One point per live, public drop. */
export function treasureData(drops: Drop[], nowSec = Math.floor(Date.now() / 1000)): FeatureCollection<Point, Props> {
  const features: Feature<Point, Props>[] = [];
  for (const d of drops) {
    if (d.status !== DROP_STATUS.Active || d.expiry <= nowSec) continue;
    if (d.lat === 0 && d.lng === 0) continue; // private drops sit at (0,0) on-chain
    const rarity = getDropRarity(d.amount);
    features.push({
      type: "Feature", id: Number(d.id), properties: { rarity, ...TREASURE[rarity], phase: phaseOf(d.id) },
      geometry: { type: "Point", coordinates: [gpsToDeg(d.lng), gpsToDeg(d.lat)] },
    });
  }
  return { type: "FeatureCollection", features };
}

const SRC = "gd-lab-treasure";
const L = { bloom: "gd-lab-bloom", halo: "gd-lab-halo", ripple: "gd-lab-ripple", core: "gd-lab-core" } as const;

/** A radius in px that grows with zoom, times the rarity scale. */
const sized = (z2: number, z10: number, z15: number, z18: number) => ["interpolate", ["exponential", 1.5], ["zoom"],
  2, ["*", ["get", "scale"], z2], 10, ["*", ["get", "scale"], z10], 15, ["*", ["get", "scale"], z15], 18, ["*", ["get", "scale"], z18]];

/** This drop's progress through its ping at clock t (0..1): its own phase, so drops never pulse together. */
const progress = (t: number) => ["%", ["+", t, ["get", "phase"]], 1];
const grow = (t: number, from: number, by: number) => ["*", ["get", "scale"], ["+", from, ["*", by, progress(t)]]];
/** Ripple radius at clock t. */
const rippleRadius = (t: number) => ["interpolate", ["exponential", 1.5], ["zoom"], 12, grow(t, 5, 14), 15, grow(t, 8, 40), 18, grow(t, 18, 96)];
/** Ripple opacity at clock t: bright as it leaves the drop, gone as it spreads. */
const rippleOpacity = (t: number) => ["*", 0.4, ["^", ["-", 1, progress(t)], 2]];

export interface Treasure {
  update(drops: Drop[]): void;
  destroy(): void;
}

const RIPPLE_MS = 2800;

/**
 * Add the treasure layers (and beams) to a loaded map. `animate` runs the sonar
 * ripple (about 24 repaints a second, paused while the tab is hidden or the map
 * is zoomed out); off for Lite and reduced motion, where the blooms stay still.
 */
export function attachTreasure(map: maplibregl.Map, { animate, beams = true }: { animate: boolean; beams?: boolean }): Treasure {
  map.addSource(SRC, { type: "geojson", data: treasureData([]) });
  const circle = { type: "circle", source: SRC } as const;
  const flat = { "circle-pitch-alignment": "map" } as const;

  // A wide, faint bloom under a smaller warm halo: soft light, not a disc.
  map.addLayer({ id: L.bloom, ...circle, paint: { ...flat, "circle-color": GOLD.bloom, "circle-radius": sized(9, 14, 46, 110) as never, "circle-blur": 1, "circle-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 14, 0.22] } });
  map.addLayer({ id: L.halo, ...circle, paint: { ...flat, "circle-color": GOLD.halo, "circle-radius": sized(3.5, 5, 15, 34) as never, "circle-blur": 1, "circle-opacity": 0.7 } });
  if (animate) {
    map.addLayer({
      id: L.ripple, ...circle, minzoom: 12,
      paint: { ...flat, "circle-color": "rgba(0,0,0,0)", "circle-radius": rippleRadius(0) as never, "circle-stroke-color": GOLD.halo, "circle-stroke-width": 1, "circle-stroke-opacity": rippleOpacity(0) as never },
    });
  }
  map.addLayer({ id: L.core, ...circle, paint: { ...flat, "circle-color": GOLD.core, "circle-radius": sized(1.4, 2, 3, 5) as never, "circle-blur": 0.4, "circle-opacity": 0.95 } });

  const beamLayer = beams ? attachBeams(map) : null;

  let timer: ReturnType<typeof setInterval> | null = null;
  if (animate) {
    const start = performance.now();
    timer = setInterval(() => {
      if (document.hidden || !map.getLayer(L.ripple) || map.getZoom() < 12) return;
      const t = ((performance.now() - start) % RIPPLE_MS) / RIPPLE_MS;
      map.setPaintProperty(L.ripple, "circle-radius", rippleRadius(t));
      map.setPaintProperty(L.ripple, "circle-stroke-opacity", rippleOpacity(t));
    }, 42);
  }

  return {
    update(drops) {
      (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(treasureData(drops));
      beamLayer?.update(drops);
    },
    destroy() {
      if (timer) clearInterval(timer);
      beamLayer?.destroy();
      try {
        for (const id of Object.values(L)) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch { /* removed with the map */ }
    },
  };
}
