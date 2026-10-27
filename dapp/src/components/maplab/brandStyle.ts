// "GoodDrops Night": the OpenFreeMap dark style, recoloured into the brand.
//
// We keep OpenFreeMap's tiles, fonts and sprite (free, no key, already cached by
// returning players) and only rewrite paint properties, so the new look costs no
// extra download. Pure: base style in, branded style out, unit-tested.

import type {
  LayerSpecification,
  SkySpecification,
  LightSpecification,
  StyleSpecification,
} from "maplibre-gl";

export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/** The palette, in one place. Land is the darkest brand indigo; roads climb toward brand blue. */
export const NIGHT = {
  land: "#0B0C29",
  landAlt: "#0F1134", // residential
  green: "#0C1A30", // parks and woods: a cool teal-indigo, never real green
  water: "#05061C",
  waterLabel: "#5A63B8",
  building: "#151843",
  buildingEdge: "#161A4C",
  roadMinor: "#1B1F66",
  roadMajor: "#2730A2",
  roadMotorway: "#3A43DA",
  rail: "#22276E",
  boundary: "#353B92",
  labelStrong: "#E7E9FF",
  labelSoft: "#A3A8E6",
  roadLabel: "#7E84CF",
  halo: "#0B0C29",
} as const;

type Layer = LayerSpecification;
type Paint = Record<string, unknown>;

/** Clutter the hunt doesn't need: one-way arrows and rail dash overlays. */
const DROP_LAYER = /^(road_oneway|road_oneway_opposite|railway_transit_dashline|railway_minor_dashline|railway_dashline)$/;

function recolor(layer: Layer): Layer | null {
  if (DROP_LAYER.test(layer.id)) return null;
  const id = layer.id;
  const paint: Paint = { ...((layer as { paint?: Paint }).paint ?? {}) };
  const layout: Paint = { ...((layer as { layout?: Paint }).layout ?? {}) };

  switch (layer.type) {
    case "background":
      paint["background-color"] = NIGHT.land;
      break;
    case "fill":
      if (id === "water") paint["fill-color"] = NIGHT.water;
      else if (id.startsWith("landuse_residential")) paint["fill-color"] = NIGHT.landAlt;
      else if (/park|wood|landcover/.test(id)) {
        paint["fill-color"] = NIGHT.green;
        paint["fill-opacity"] = 0.9;
        delete paint["fill-pattern"]; // flat colour; the textured pattern isn't in the sprite
      }
      else if (id === "building") { paint["fill-color"] = NIGHT.building; paint["fill-outline-color"] = NIGHT.buildingEdge; }
      else if (/aeroway|road_area/.test(id)) paint["fill-color"] = NIGHT.roadMinor;
      break;
    case "line":
      if (id === "waterway") paint["line-color"] = NIGHT.water;
      else if (/motorway/.test(id)) paint["line-color"] = id.includes("casing") ? NIGHT.land : NIGHT.roadMotorway;
      else if (/major/.test(id)) paint["line-color"] = id.includes("casing") ? NIGHT.land : NIGHT.roadMajor;
      else if (/minor|path|pier|taxiway|runway/.test(id)) paint["line-color"] = NIGHT.roadMinor;
      else if (/rail/.test(id)) paint["line-color"] = NIGHT.rail;
      else if (/boundary/.test(id)) paint["line-color"] = NIGHT.boundary;
      break;
    case "symbol": {
      const isPlace = id.startsWith("place_");
      const strong = /place_(city|town|city_large|country|state)/.test(id);
      paint["text-color"] = id === "water_name" ? NIGHT.waterLabel
        : isPlace ? (strong ? NIGHT.labelStrong : NIGHT.labelSoft)
        : NIGHT.roadLabel;
      paint["text-halo-color"] = NIGHT.halo;
      paint["text-halo-width"] = 1.4;
      paint["text-halo-blur"] = 0.4;
      // Place names read as text only: the base style's dot icons aren't in the sprite.
      if (isPlace) delete layout["icon-image"];
      // Our own labels (drops, places) win collisions; base labels yield to them.
      break;
    }
  }
  return { ...layer, paint, layout } as Layer;
}

/** Turn OpenFreeMap's dark style into GoodDrops Night. Never throws on unknown layers. */
export function brandStyle(base: StyleSpecification): StyleSpecification {
  const layers = base.layers.map(recolor).filter((l): l is Layer => l !== null);
  return { ...base, name: "GoodDrops Night", layers };
}

/** Brand-blue 3D buildings (the look chosen in the lab), by building height. */
export const BRAND_BUILDINGS = { low: "#272C92", high: "#3940C0", opacity: 0.95 } as const;

// ── Sky and light that follow the hunter's local time ─────────────────────────

export type DayPhase = "day" | "dusk" | "night";

export function phaseForHour(hour: number): DayPhase {
  if (hour >= 7 && hour < 17) return "day";
  if ((hour >= 17 && hour < 20) || (hour >= 5 && hour < 7)) return "dusk";
  return "night";
}

/** Horizon colours seen when the map is tilted. Land stays dark in every phase. */
export function skyFor(phase: DayPhase): SkySpecification {
  const p = {
    day: { sky: "#3B47E8", horizon: "#8E97FF", fog: "#141766" },
    dusk: { sky: "#25207A", horizon: "#FF9825", fog: "#2A1A55" },
    night: { sky: "#05061C", horizon: "#2727E2", fog: "#0B0C29" },
  }[phase];
  return {
    "sky-color": p.sky,
    "horizon-color": p.horizon,
    "fog-color": p.fog,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.25,
    "atmosphere-blend": 0,
  };
}

/**
 * Light for the extruded buildings. Kept near-neutral in every phase so brand
 * blue stays brand blue: a warm dusk light turned the buildings muddy purple.
 * The time of day shows in the sky, not in the buildings.
 */
export function lightFor(phase: DayPhase): LightSpecification {
  return {
    anchor: "viewport",
    color: phase === "dusk" ? "#FFF1E4" : phase === "night" ? "#E6E9FF" : "#FFFFFF",
    intensity: 0.4,
    position: [1.15, 210, 30],
  };
}
