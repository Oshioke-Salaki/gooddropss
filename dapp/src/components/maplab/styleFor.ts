import type { StyleSpecification } from "maplibre-gl";
import { MAP_STYLE } from "@/components/map/style";
import { BASE_STYLE_URL, brandStyle } from "./brandStyle";
import type { LabSettings } from "./types";

let branded: StyleSpecification | null = null;

/** The base map for a look. Falls back to the original style if the fetch fails, so the map always loads. */
export async function styleFor(look: LabSettings["look"]): Promise<StyleSpecification | string> {
  if (look === "original") return MAP_STYLE;
  if (branded) return branded;
  try {
    const res = await fetch(BASE_STYLE_URL);
    if (!res.ok) throw new Error(String(res.status));
    branded = brandStyle(await res.json());
    return branded;
  } catch {
    return MAP_STYLE;
  }
}
