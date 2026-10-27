// Which version of the map a device gets. Most GoodDrops players are on
// mid-range Android phones, often inside a wallet's WebView, on mobile data.
//
//   standard  the new look: tilted camera, gradient 3D buildings, sky
//   lite      flat camera, no buildings, capped resolution (the map's light mode)
//
// `?tier=standard|lite` overrides detection, for testing on a real phone.

import { isLightDevice } from "@/lib/deviceTier";

export type Tier = "standard" | "lite";
export type Quality = { tier: Tier; reasons: string[] };

export function detectQuality(search = typeof location !== "undefined" ? location.search : ""): Quality {
  const forced = new URLSearchParams(search).get("tier");
  if (forced === "standard" || forced === "lite") return { tier: forced, reasons: [`forced by ?tier=${forced}`] };
  if (isLightDevice()) return { tier: "lite", reasons: ["low memory, few cores, 2G or Data Saver"] };
  return { tier: "standard", reasons: ["capable device"] };
}
