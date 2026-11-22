import { describe, expect, it } from "vitest";
import { TREASURE, treasureData } from "./treasureLight";
import { BEAM_PX, beamScale, beamSpots } from "./beams";
import type { Drop } from "@/types";

const G = 10n ** 18n;
const d = (id: number, over: Partial<Drop> = {}): Drop => ({
  id: BigInt(id), dropper: "0x00000000000000000000000000000000000000aa", amount: 5n * G,
  claimer: "0x0000000000000000000000000000000000000000", expiry: 2_000, claimedAt: 0, createdAt: 0,
  status: 0, lat: 10_520_000, lng: 7_440_000, hint: "", ...over,
});
const hidden = [d(2, { status: 1 }), d(3, { expiry: 500 }), d(4, { lat: 0, lng: 0 })];

describe("treasureData", () => {
  it("lights only live, public drops, sized by rarity", () => {
    const fc = treasureData([d(1, { amount: 500n * G }), ...hidden], 1_000);
    expect(fc.features.map((f) => f.id)).toEqual([1]);
    expect(fc.features[0].properties).toMatchObject({ rarity: "legendary", scale: TREASURE.legendary.scale });
    expect(fc.features[0].geometry.coordinates[1]).toBeCloseTo(10.52, 6);
    expect(TREASURE.legendary.scale).toBeGreaterThan(TREASURE.common.scale);
  });

  it("staggers ripples: neighbouring drops sit far apart in the cycle", () => {
    const fc = treasureData([d(10), d(11), d(12)], 1_000);
    const phases = fc.features.map((f) => f.properties.phase);
    for (const ph of phases) { expect(ph).toBeGreaterThanOrEqual(0); expect(ph).toBeLessThan(1); }
    expect(Math.abs(phases[0] - phases[1])).toBeGreaterThan(0.2);
  });
});

describe("beams", () => {
  it("rise only over live, public rare and legendary drops", () => {
    const spots = beamSpots([d(1, { amount: 1n * G }), d(5, { amount: 20n * G }), d(6, { amount: 60n * G }), d(7, { amount: 500n * G }), ...hidden.map((x) => ({ ...x, amount: 500n * G }))], 1_000);
    expect(spots.map((s) => [s.id, s.rarity, s.height])).toEqual([["6", "rare", BEAM_PX.rare], ["7", "legendary", BEAM_PX.legendary]]);
    expect(BEAM_PX.legendary).toBeGreaterThan(BEAM_PX.rare);
  });

  it("scale with zoom: full size at street level, small zoomed out, capped up close", () => {
    expect(beamScale(16.5)).toBe(1);
    expect(beamScale(15.5)).toBeCloseTo(0.5);
    expect(beamScale(10)).toBe(0.3);
    expect(beamScale(20)).toBe(1.8);
  });
});
