import { describe, it, expect } from "vitest";
import { countDropsPerLandmark } from "./landmarkDrops";

// ~111 m per 0.001° of latitude.
const A = { id: "a", lat: 10.0, lng: 7.0 };
const B = { id: "b", lat: 10.0015, lng: 7.0 }; // ~167 m north of A

describe("countDropsPerLandmark", () => {
  it("never counts a drop for two landmarks", () => {
    // Both drops are within 150 m of BOTH landmarks.
    const drops = [{ lat: 10.0005, lng: 7.0 }, { lat: 10.001, lng: 7.0 }];
    const c = countDropsPerLandmark(drops, [A, B], 150);
    expect((c.get("a") ?? 0) + (c.get("b") ?? 0)).toBe(2);
    expect(c.get("a")).toBe(1); // nearer A
    expect(c.get("b")).toBe(1); // nearer B
  });

  it("ignores drops outside every landmark's radius", () => {
    const c = countDropsPerLandmark([{ lat: 10.01, lng: 7.0 }], [A, B], 150);
    expect(c.size).toBe(0);
  });

  it("is stable on an exact tie", () => {
    const mid = { lat: 10.00075, lng: 7.0 };
    expect(countDropsPerLandmark([mid], [A, B], 150).get("a")).toBe(1);
  });
});
