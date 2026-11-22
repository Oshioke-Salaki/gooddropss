import type { DayPhase } from "./brandStyle";

export type LabSettings = {
  look: "midnight" | "night" | "original";
  buildings: boolean;
  buildingColor: "brand" | "classic";
  /** "auto" follows the real sun for the hunter's location and time. */
  sky: "auto" | DayPhase;
  /** Open on a spinning globe, then dive to the hunter's street. */
  globe: boolean;
  /** Gold light on live drops: halos, ripples, and beams for rare finds. */
  treasure: boolean;
  /** Slow camera drift around the scene when the hunter is idle. */
  drift: boolean;
  /** Real elevation (extra downloads; off by default). */
  terrain: boolean;
};

export type LabStats = { fps: number; zoom: number };
