import { describe, it, expect } from "vitest";
import { scatterPoints } from "@/lib/scatter";
import { haversineDistance } from "@/lib/utils";

describe("scatterPoints", () => {
  it("returns the exact centre for a single point", () => {
    expect(scatterPoints(6.5, 3.3, 1, 100)).toEqual([{ lat: 6.5, lng: 3.3 }]);
  });

  it("returns the requested number of points", () => {
    expect(scatterPoints(6.5, 3.3, 20, 100)).toHaveLength(20);
    expect(scatterPoints(6.5, 3.3, 0, 100)).toHaveLength(0);
  });

  it("keeps every point within the radius of the centre", () => {
    const lat = 10.4835, lng = 7.4175, R = 100;
    for (const p of scatterPoints(lat, lng, 20, R)) {
      expect(haversineDistance(lat, lng, p.lat, p.lng)).toBeLessThanOrEqual(R + 1); // +1m float slack
    }
  });

  it("spreads points apart (no two share a coordinate)", () => {
    const pts = scatterPoints(10.4835, 7.4175, 15, 100);
    const seen = new Set(pts.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`));
    expect(seen.size).toBe(pts.length);
  });
});
