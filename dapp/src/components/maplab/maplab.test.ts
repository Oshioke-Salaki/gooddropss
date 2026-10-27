import { describe, it, expect } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { brandStyle, NIGHT, phaseForHour, skyFor, lightFor } from "./brandStyle";

const base = {
  version: 8, sources: {}, glyphs: "g", sprite: "s",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#000" } },
    { id: "water", type: "fill", source: "o", "source-layer": "water", paint: { "fill-color": "#111" } },
    { id: "landuse_park", type: "fill", source: "o", "source-layer": "landuse", paint: {} },
    { id: "highway_motorway_inner", type: "line", source: "o", "source-layer": "transportation", paint: {} },
    { id: "highway_minor", type: "line", source: "o", "source-layer": "transportation", paint: {} },
    { id: "road_oneway", type: "symbol", source: "o", "source-layer": "transportation", layout: { "icon-image": "arrow" } },
    { id: "railway_dashline", type: "line", source: "o", "source-layer": "transportation", paint: {} },
    { id: "place_city", type: "symbol", source: "o", "source-layer": "place", layout: { "text-field": "{name}" }, paint: {} },
    { id: "place_village", type: "symbol", source: "o", "source-layer": "place", layout: { "text-field": "{name}" }, paint: {} },
    { id: "some_future_layer", type: "hillshade", source: "o" },
  ],
} as unknown as StyleSpecification;

describe("brandStyle", () => {
  const out = brandStyle(base);
  const byId = (id: string) => out.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> } | undefined;

  it("recolours land, water, parks and roads into the palette", () => {
    expect(byId("background")?.paint?.["background-color"]).toBe(NIGHT.land);
    expect(byId("water")?.paint?.["fill-color"]).toBe(NIGHT.water);
    expect(byId("landuse_park")?.paint?.["fill-color"]).toBe(NIGHT.green);
    expect(byId("highway_motorway_inner")?.paint?.["line-color"]).toBe(NIGHT.roadMotorway);
    expect(byId("highway_minor")?.paint?.["line-color"]).toBe(NIGHT.roadMinor);
  });
  it("ranks place labels: cities strong, villages soft, all with a halo", () => {
    expect(byId("place_city")?.paint?.["text-color"]).toBe(NIGHT.labelStrong);
    expect(byId("place_village")?.paint?.["text-color"]).toBe(NIGHT.labelSoft);
    expect(byId("place_village")?.paint?.["text-halo-color"]).toBe(NIGHT.halo);
  });
  it("removes one-way arrows and rail dash overlays", () => {
    expect(byId("road_oneway")).toBeUndefined();
    expect(byId("railway_dashline")).toBeUndefined();
  });
  it("keeps unknown layers and never mutates its input", () => {
    expect(byId("some_future_layer")).toBeDefined();
    expect((base.layers[0] as { paint: Record<string, unknown> }).paint["background-color"]).toBe("#000");
    expect(out.name).toBe("GoodDrops Night");
    expect(out.glyphs).toBe("g");
  });
});

describe("time of day", () => {
  it("splits the day at the right hours", () => {
    expect([0, 4, 5, 6, 7, 12, 16, 17, 19, 20, 23].map(phaseForHour)).toEqual(
      ["night", "night", "dusk", "dusk", "day", "day", "day", "dusk", "dusk", "night", "night"]);
  });
  it("gives every phase a complete sky and a light", () => {
    for (const p of ["day", "dusk", "night"] as const) {
      expect(skyFor(p)["horizon-color"]).toBeTruthy();
      expect(lightFor(p).anchor).toBe("viewport");
      expect(lightFor(p).intensity).toBe(0.4);
    }
  });
});
