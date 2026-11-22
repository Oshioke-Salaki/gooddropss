// Where the sun is, right now, for the hunter: drives the map's sky and the
// direction of the light on the 3D buildings, so the map matches the real day.
//
// Standard low-precision solar position (the formulas popularised by SunCalc,
// after Astronomy Answers): accurate to well under a degree, which is plenty
// for lighting. Pure and unit-tested.

import type { LightSpecification } from "maplibre-gl";
import type { DayPhase } from "./brandStyle";

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;

export interface SunPosition {
  /** Degrees above the horizon (negative: below). */
  altitude: number;
  /** Compass bearing in degrees, clockwise from north. */
  bearing: number;
}

export function sunPosition(date: Date, lat: number, lng: number): SunPosition {
  const d = toDays(date);
  const lw = RAD * -lng;
  const phi = RAD * lat;

  const M = RAD * (357.5291 + 0.98560028 * d); // solar mean anomaly
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); // equation of centre
  const L = M + C + RAD * 102.9372 + Math.PI; // ecliptic longitude
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra; // hour angle

  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Measured from south, toward west; turned into a compass bearing from north.
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return {
    altitude: altitude / RAD,
    bearing: (((azimuth / RAD + 180) % 360) + 360) % 360,
  };
}

/** Day above 6°, twilight (golden hour into dusk) between -6° and 6°, night below. */
export function phaseForSun(altitude: number): DayPhase {
  if (altitude > 6) return "day";
  if (altitude >= -6) return "dusk";
  return "night";
}

/**
 * Light on the 3D buildings, coming from the real sun's direction and height.
 * The colour stays near-neutral (a warm light turned brand-blue buildings muddy
 * purple); the time of day shows in the sky. At night: a soft, high, cool light.
 */
export function lightForSun(sun: SunPosition): LightSpecification {
  const phase = phaseForSun(sun.altitude);
  if (phase === "night") {
    return { anchor: "map", color: "#E6E9FF", intensity: 0.3, position: [1.15, 210, 30] };
  }
  // Polar angle: 0 = straight overhead. Kept off the extremes so walls never go
  // fully black or fully flat.
  const polar = Math.min(80, Math.max(15, 90 - sun.altitude));
  return {
    anchor: "map",
    color: phase === "dusk" ? "#FFF1E4" : "#FFFFFF",
    intensity: phase === "dusk" ? 0.38 : 0.45,
    position: [1.15, sun.bearing, polar],
  };
}
