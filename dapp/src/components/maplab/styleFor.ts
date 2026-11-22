import type { StyleSpecification } from "maplibre-gl";
import { MAP_STYLE } from "@/components/map/style";
import { brandStyle } from "./brandStyle";
import { midnightStyle } from "./midnight";
import type { LabSettings } from "./types";

// The base style JSON, fetched once (the original look and GoodDrops Night are
// both built from it).
let base: Promise<StyleSpecification> | null = null;
function baseStyle(): Promise<StyleSpecification> {
  base ??= fetch(MAP_STYLE).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<StyleSpecification>;
  }).catch((e) => { base = null; throw e; });
  return base;
}

/**
 * The base map for a look, as a style object. `globe` sets the globe projection
 * inside the style, so the very first frame is already a globe (MapLibre's
 * globe hands over to the flat map by itself as the camera zooms in).
 * Falls back to the original style URL if the fetch fails, so the map always loads.
 */
export async function styleFor(look: LabSettings["look"], { globe = false }: { globe?: boolean } = {}): Promise<StyleSpecification | string> {
  try {
    const s = await baseStyle();
    const styled = look === "midnight" ? midnightStyle(s) : look === "night" ? brandStyle(s) : s;
    return globe ? { ...styled, projection: { type: "globe" } } : styled;
  } catch {
    return MAP_STYLE;
  }
}
