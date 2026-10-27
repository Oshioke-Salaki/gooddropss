// Brand-blue buildings, shared by every map in the app so they never drift apart.
//
//   "3d"    extruded, for maps that can tilt (main map, location picker, batch drops)
//   "flat"  footprints only, for maps locked top-down (event map, hunter finds):
//           from straight above an extrusion looks the same but costs more to draw.
// Light-mode phones (Data Saver, 2G, low RAM or cores) get no buildings at all,
// matching the main map. Never throws: buildings are decoration.

import type { Map as MLMap } from "maplibre-gl";
import { isLightDevice } from "@/lib/deviceTier";

/** Deep blue at street level, lighter as buildings get taller. */
export const BRAND_BUILDINGS = { low: "#272C92", high: "#3940C0", opacity: 0.95 } as const;
export const BUILDINGS_LAYER = "gd-3d-buildings";

const HEIGHT = ["coalesce", ["get", "render_height"], 10] as const;
const COLOR = ["interpolate", ["linear"], HEIGHT, 0, BRAND_BUILDINGS.low, 40, BRAND_BUILDINGS.high] as const;
const FLAT_COLOR = ["interpolate", ["linear"], HEIGHT, 0, "#333AB4", 40, "#3F46CC"] as const;

export function addBuildings(
  map: MLMap,
  opts: { mode?: "3d" | "flat"; brand?: boolean; minzoom?: number; force?: boolean } = {},
): void {
  const { mode = "3d", brand = true, minzoom = 14.5, force = false } = opts;
  try {
    if (!force && isLightDevice()) return;
    if (map.getLayer(BUILDINGS_LAYER)) return;
    const style = map.getStyle();
    const source = Object.keys(style.sources ?? {}).find(
      (k) => (style.sources as Record<string, { type?: string }>)[k]?.type === "vector",
    );
    if (!source) return;

    if (mode === "flat") {
      map.addLayer({
        id: BUILDINGS_LAYER,
        type: "fill",
        source,
        "source-layer": "building",
        minzoom,
        // Unlit footprints read darker than lit 3D roofs; lift them to match.
        paint: { "fill-color": FLAT_COLOR as never, "fill-opacity": BRAND_BUILDINGS.opacity },
      });
      return;
    }

    map.addLayer({
      id: BUILDINGS_LAYER,
      type: "fill-extrusion",
      source,
      "source-layer": "building",
      minzoom,
      paint: brand
        ? {
            "fill-extrusion-color": COLOR as never,
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": BRAND_BUILDINGS.opacity,
            "fill-extrusion-vertical-gradient": true,
          }
        : {
            "fill-extrusion-color": "#1e2030",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.7,
          },
    });
  } catch { /* buildings are optional; never block a map */ }
}
