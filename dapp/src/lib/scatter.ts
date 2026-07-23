import type { LatLng } from "@/types";

// Spread `count` points across a disc of radius `radiusM` around a centre, evenly
// enough that map markers don't overlap (a sunflower / golden-angle layout) with
// a touch of jitter so it feels organic rather than mechanical. Used by multi-drop
// to scatter N identical drops around one spot so each is distinct and clickable.
export function scatterPoints(lat: number, lng: number, count: number, radiusM: number): LatLng[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  if (n === 1) return [{ lat, lng }];

  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  // Guard the cosine near the poles so longitude spacing never blows up.
  const mPerDegLng = 111_320 * Math.max(Math.cos(latRad), 0.01);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~137.5°, the classic even-spread angle

  const pts: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    // Radius ramps 20%→95% of the disc (nothing stacked dead-centre, nothing past
    // the edge). sqrt keeps the areal density roughly uniform.
    const frac = i / (n - 1);
    const r = radiusM * (0.2 + 0.75 * Math.sqrt(frac));
    const a = i * GOLDEN + (Math.random() - 0.5) * 0.35;
    const dLat = (r * Math.sin(a)) / mPerDegLat;
    const dLng = (r * Math.cos(a)) / mPerDegLng;
    pts.push({ lat: lat + dLat, lng: lng + dLng });
  }
  return pts;
}
