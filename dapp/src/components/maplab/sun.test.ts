import { describe, expect, it } from "vitest";
import { lightForSun, phaseForSun, sunPosition } from "./sun";

const KADUNA = { lat: 10.52, lng: 7.44 };

describe("sunPosition", () => {
  it("is nearly overhead at the equator at noon on the March equinox", () => {
    const s = sunPosition(new Date("2026-03-20T12:07:00Z"), 0, 0);
    expect(s.altitude).toBeGreaterThan(88);
  });

  it("is below the horizon in Kaduna at midnight", () => {
    expect(sunPosition(new Date("2026-11-22T23:00:00Z"), KADUNA.lat, KADUNA.lng).altitude).toBeLessThan(-30);
  });

  it("rises in the east and sets in the west", () => {
    const morning = sunPosition(new Date("2026-11-22T06:30:00Z"), KADUNA.lat, KADUNA.lng); // ~07:30 local
    const evening = sunPosition(new Date("2026-11-22T16:30:00Z"), KADUNA.lat, KADUNA.lng); // ~17:30 local
    expect(morning.bearing).toBeGreaterThan(90);  // east-south-east in November
    expect(morning.bearing).toBeLessThan(135);
    expect(evening.bearing).toBeGreaterThan(225); // west-south-west
    expect(evening.bearing).toBeLessThan(270);
  });

  it("stands to the south at Kaduna's noon in November (sun over the southern tropics)", () => {
    const noon = sunPosition(new Date("2026-11-22T11:35:00Z"), KADUNA.lat, KADUNA.lng);
    expect(noon.altitude).toBeGreaterThan(55);
    expect(Math.abs(noon.bearing - 180)).toBeLessThan(15);
  });
});

describe("phaseForSun", () => {
  it("day above 6°, twilight between -6° and 6°, night below", () => {
    expect(phaseForSun(30)).toBe("day");
    expect(phaseForSun(6.1)).toBe("day");
    expect(phaseForSun(3)).toBe("dusk");
    expect(phaseForSun(-6)).toBe("dusk");
    expect(phaseForSun(-6.1)).toBe("night");
  });
});

describe("lightForSun", () => {
  it("comes from the sun's compass direction, never from the extremes", () => {
    const l = lightForSun({ altitude: 40, bearing: 120 });
    expect(l.anchor).toBe("map");
    expect(l.position).toEqual([1.15, 120, 50]);
    expect((lightForSun({ altitude: 89, bearing: 0 }).position as number[])[2]).toBe(15);
    expect((lightForSun({ altitude: 2, bearing: 250 }).position as number[])[2]).toBe(80);
  });

  it("keeps a near-neutral colour (brand blue stays brand blue) and a soft night light", () => {
    expect(lightForSun({ altitude: 40, bearing: 0 }).color).toBe("#FFFFFF");
    expect(lightForSun({ altitude: -20, bearing: 0 })).toMatchObject({ color: "#E6E9FF", intensity: 0.3 });
  });
});
