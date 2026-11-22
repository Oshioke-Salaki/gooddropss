// "Midnight": the city at night from a drone. One cool world in shades of brand
// blue, where the only warm colour on the map is treasure (see treasureLight).
//
//   • Roads are drawn as light: a soft blurred glow under a thin bright core,
//     brighter for bigger roads (hierarchy by value, not by more colours).
//   • Coastlines glow faintly, so the globe reads as Earth at night.
//   • Labels are quiet; casings, one-way arrows and rail dashes are gone.
//
// Same free OpenFreeMap tiles, fonts and sprite as today: only paint changes and
// a few extra layers on the same source, so it costs no extra download. Pure and
// unit-tested; unknown layers pass through untouched.

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export const MIDNIGHT = {
  land: "#060818",
  landAlt: "#080B20",
  green: "#07131F",
  water: "#02030B",
  coast: "#1F4BFF",
  building: "#0B0F2E",
  minor: "#121A47",
  path: "#0D1336",
  majorGlow: "#1E40FF",
  majorCore: "#6F94FF",
  motorwayGlow: "#2D5BFF",
  motorwayCore: "#A9C1FF",
  rail: "#14205A",
  boundary: "#1B2A7A",
  labelStrong: "#D6DEFF",
  labelSoft: "#7C8BC8",
  roadLabel: "#5E6FB0",
  halo: "#060818",
} as const;

/** 3D building light by height: low blocks sink into the night, towers catch the city glow. */
export const MIDNIGHT_BUILDINGS = {
  color: ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 10], 0, "#0C1238", 40, "#1C2C8F", 90, "#2B45D6"],
  opacity: 0.92,
} as const;

type Layer = LayerSpecification;
type Paint = Record<string, unknown>;

const DROPPED = /^(road_oneway|road_oneway_opposite|railway_transit_dashline|railway_minor_dashline|railway_dashline|highway_major_casing|highway_motorway_casing|aeroway-runway-casing)$/;

/** Width of a road at a zoom, scaled: glows are wide and soft, cores thin. */
const roadWidth = (k: number) => ["interpolate", ["exponential", 1.5], ["zoom"], 6, 0.4 * k, 12, 1.2 * k, 16, 4 * k, 20, 16 * k];

function recolor(layer: Layer): Layer | null {
  if (DROPPED.test(layer.id)) return null;
  const id = layer.id;
  const paint: Paint = { ...((layer as { paint?: Paint }).paint ?? {}) };
  const layout: Paint = { ...((layer as { layout?: Paint }).layout ?? {}) };
  switch (layer.type) {
    case "background":
      paint["background-color"] = MIDNIGHT.land;
      break;
    case "fill":
      delete paint["fill-pattern"];
      if (id === "water") paint["fill-color"] = MIDNIGHT.water;
      else if (id.startsWith("landuse_residential")) paint["fill-color"] = MIDNIGHT.landAlt;
      else if (/park|wood|landcover/.test(id)) { paint["fill-color"] = MIDNIGHT.green; paint["fill-opacity"] = 0.9; }
      else if (id === "building") { paint["fill-color"] = MIDNIGHT.building; paint["fill-outline-color"] = MIDNIGHT.building; }
      else if (/aeroway|road_area/.test(id)) paint["fill-color"] = MIDNIGHT.minor;
      break;
    case "line":
      if (id === "waterway") paint["line-color"] = MIDNIGHT.water;
      else if (id === "highway_motorway_inner") { paint["line-color"] = MIDNIGHT.motorwayCore; paint["line-width"] = roadWidth(0.55); }
      else if (id === "highway_major_inner") { paint["line-color"] = MIDNIGHT.majorCore; paint["line-width"] = roadWidth(0.45); }
      else if (/motorway_subtle|major_subtle/.test(id)) { paint["line-color"] = MIDNIGHT.majorGlow; paint["line-opacity"] = 0.5; }
      else if (id === "highway_path") paint["line-color"] = MIDNIGHT.path;
      else if (/minor|pier|taxiway|runway/.test(id)) paint["line-color"] = MIDNIGHT.minor;
      else if (/rail/.test(id)) paint["line-color"] = MIDNIGHT.rail;
      else if (/boundary/.test(id)) { paint["line-color"] = MIDNIGHT.boundary; paint["line-opacity"] = 0.7; }
      break;
    case "symbol": {
      const isPlace = id.startsWith("place_");
      const strong = /place_(city|town|city_large|country|state)/.test(id);
      paint["text-color"] = id === "water_name" ? MIDNIGHT.labelSoft
        : isPlace ? (strong ? MIDNIGHT.labelStrong : MIDNIGHT.labelSoft)
        : MIDNIGHT.roadLabel;
      paint["text-halo-color"] = MIDNIGHT.halo;
      paint["text-halo-width"] = 1.4;
      paint["text-halo-blur"] = 0.5;
      if (isPlace) delete layout["icon-image"]; // the base style's dot icons aren't in the sprite
      break;
    }
  }
  return { ...layer, paint, layout } as Layer;
}

/** A soft, wide, blurred copy of a road layer, drawn under it: the road's glow. */
function glowFor(layer: Layer, color: string, widthK: number, opacity: number): Layer {
  const l = layer as Layer & { source: string; "source-layer"?: string; filter?: unknown; minzoom?: number; maxzoom?: number };
  return {
    id: `gd-mid-glow-${layer.id}`,
    type: "line",
    source: l.source,
    ...(l["source-layer"] ? { "source-layer": l["source-layer"] } : {}),
    ...(l.filter ? { filter: l.filter } : {}),
    ...(l.minzoom !== undefined ? { minzoom: l.minzoom } : {}),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": roadWidth(widthK), "line-blur": roadWidth(widthK * 0.8), "line-opacity": opacity },
  } as Layer;
}

/** Turn OpenFreeMap's dark style into Midnight. Never throws on unknown layers. */
export function midnightStyle(base: StyleSpecification): StyleSpecification {
  const out: Layer[] = [];
  for (const layer of base.layers) {
    const r = recolor(layer);
    if (!r) continue;
    // Glows go right under the road they light.
    if (layer.id === "highway_major_inner") out.push(glowFor(layer, MIDNIGHT.majorGlow, 3.2, 0.35));
    if (layer.id === "highway_motorway_inner") out.push(glowFor(layer, MIDNIGHT.motorwayGlow, 4, 0.45));
    out.push(r);
    // Coastlines: a faint glowing outline on every water body, just above it.
    if (layer.id === "water") {
      const w = layer as Layer & { source: string; "source-layer"?: string };
      out.push({
        id: "gd-mid-coast", type: "line", source: w.source, "source-layer": w["source-layer"] ?? "water",
        paint: {
          "line-color": MIDNIGHT.coast,
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1, 14, 1.6],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 14, 2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.75, 10, 0.5, 16, 0.3],
        },
      } as Layer);
    }
  }
  return { ...base, name: "GoodDrops Midnight", layers: out };
}
