import type { DayPhase } from "./brandStyle";

export type LabSettings = {
  look: "night" | "original";
  buildings: boolean;
  buildingColor: "brand" | "classic";
  sky: "auto" | DayPhase;
};

export type LabStats = { fps: number; zoom: number };
