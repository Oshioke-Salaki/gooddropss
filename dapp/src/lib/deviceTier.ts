// A coarse "go easy on this device" signal for the expensive bits of the map
// (3D buildings, tilted camera, high-DPI rendering). Most GoodDrops players are
// on entry-level Android phones and mobile data, where those cost real frames,
// battery and megabytes.
//
// Light mode when ANY of: the person turned on Data Saver, the connection is
// 2G-class, the phone reports 2 GB of RAM or less, or 2 CPU cores or less.
// Each signal is optional in the browser; missing ones simply don't count.

interface NavigatorHints {
  connection?: { saveData?: boolean; effectiveType?: string };
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function isLightDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const n = navigator as Navigator & NavigatorHints;
  if (n.connection?.saveData) return true;
  if (n.connection?.effectiveType && /(^|-)2g$/.test(n.connection.effectiveType)) return true;
  if (typeof n.deviceMemory === "number" && n.deviceMemory <= 2) return true;
  if (typeof n.hardwareConcurrency === "number" && n.hardwareConcurrency > 0 && n.hardwareConcurrency <= 2) return true;
  return false;
}

/** People who asked for less motion get a flat, non-swooping camera too. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
