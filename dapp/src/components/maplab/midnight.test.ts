import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { MIDNIGHT, midnightStyle } from "./midnight";

const t = { source: "o", "source-layer": "transportation" };
const base = {
  version: 8, sources: {}, glyphs: "g", sprite: "s",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#000" } },
    { id: "water", type: "fill", source: "o", "source-layer": "water", paint: { "fill-color": "#111" } },
    { id: "landuse_park", type: "fill", source: "o", "source-layer": "landuse", paint: { "fill-pattern": "x" } },
    { id: "highway_major_casing", type: "line", ...t, paint: {} },
    { id: "highway_major_inner", type: "line", ...t, minzoom: 11, filter: ["==", "class", "primary"], paint: {} },
    { id: "highway_motorway_inner", type: "line", ...t, paint: {} },
    { id: "road_oneway", type: "symbol", ...t, layout: { "icon-image": "arrow" } },
    { id: "place_city", type: "symbol", source: "o", "source-layer": "place", layout: { "text-field": "{name}", "icon-image": "dot" }, paint: {} },
    { id: "some_future_layer", type: "hillshade", source: "o" },
  ],
} as unknown as StyleSpecification;

describe("midnightStyle", () => {
  const out = midnightStyle(base);
  const ids = out.layers.map((l) => l.id);
  const layer = (id: string) => out.layers.find((l) => l.id === id) as unknown as { paint: Record<string, unknown>; layout: Record<string, unknown>; filter?: unknown; minzoom?: number };

  it("drops clutter (casings, one-way arrows) and keeps unknown layers", () => {
    expect(ids).not.toContain("highway_major_casing");
    expect(ids).not.toContain("road_oneway");
    expect(ids).toContain("some_future_layer");
    expect(out.name).toBe("GoodDrops Midnight");
  });

  it("puts a soft glow right under each major road, with the road's own filter and zoom", () => {
    expect(ids.indexOf("gd-mid-glow-highway_major_inner")).toBe(ids.indexOf("highway_major_inner") - 1);
    expect(ids.indexOf("gd-mid-glow-highway_motorway_inner")).toBe(ids.indexOf("highway_motorway_inner") - 1);
    const glow = layer("gd-mid-glow-highway_major_inner");
    expect(glow.filter).toEqual(["==", "class", "primary"]);
    expect(glow.minzoom).toBe(11);
    expect(glow.paint["line-blur"]).toBeDefined();
    expect(layer("highway_major_inner").paint["line-color"]).toBe(MIDNIGHT.majorCore);
  });

  it("adds a glowing coastline just above the water", () => {
    expect(ids.indexOf("gd-mid-coast")).toBe(ids.indexOf("water") + 1);
    expect(layer("gd-mid-coast").paint["line-color"]).toBe(MIDNIGHT.coast);
  });

  it("recolours the ground and labels, and removes sprite icons and patterns the style can't draw", () => {
    expect(layer("background").paint["background-color"]).toBe(MIDNIGHT.land);
    expect(layer("landuse_park").paint["fill-pattern"]).toBeUndefined();
    expect(layer("place_city").paint["text-color"]).toBe(MIDNIGHT.labelStrong);
    expect(layer("place_city").layout["icon-image"]).toBeUndefined();
  });

  it("uses no violet or lavender: every colour is a blue or a neutral", () => {
    for (const hex of Object.values(MIDNIGHT)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(r).toBeLessThanOrEqual(Math.max(g, b) + 30); // red never leads: no purple cast
    }
  });

  it("does not mutate the base style", () => {
    expect(base.layers.find((l) => l.id === "background")).toMatchObject({ paint: { "background-color": "#000" } });
  });
});
