// Real hills and valleys under the map, from the free, key-less elevation tiles
// on AWS Open Data (Mapzen "terrarium" encoding), plus a faint brand-tinted
// hillshade so slopes read on the dark base map.
//
// Costs extra downloads (~30 KB per tile), so it's opt-in and never on Lite.

import type maplibregl from "maplibre-gl";

const SRC = "gd-lab-dem";
const HILLSHADE = "gd-lab-hillshade";
const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export function addTerrain(map: maplibregl.Map, exaggeration = 1.3): () => void {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, {
      type: "raster-dem",
      tiles: [TILES],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
      attribution: "Elevation: Mapzen, AWS Open Data",
    });
  }
  // Under the labels, so names stay crisp on top of the shading.
  const firstSymbol = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  if (!map.getLayer(HILLSHADE)) {
    map.addLayer({
      id: HILLSHADE, type: "hillshade", source: SRC,
      paint: {
        "hillshade-shadow-color": "#05061C",
        "hillshade-highlight-color": "#2A31A8",
        "hillshade-accent-color": "#0B0C29",
        "hillshade-exaggeration": 0.35,
      },
    }, firstSymbol);
  }
  map.setTerrain({ source: SRC, exaggeration });

  return () => {
    try {
      map.setTerrain(null);
      if (map.getLayer(HILLSHADE)) map.removeLayer(HILLSHADE);
      if (map.getSource(SRC)) map.removeSource(SRC);
    } catch { /* removed with the map */ }
  };
}
