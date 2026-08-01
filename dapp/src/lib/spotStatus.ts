import type { Spot, SpotStatus } from "@/types";

// Client-safe spot-lifecycle helpers. Legacy spots have no `status` field — they
// were live before moderation existed, so they're grandfathered as "active".

export function spotStatus(spot: Pick<Spot, "status">): SpotStatus {
  return spot.status ?? "active";
}

// Live to the public: on the map, payable, can run reward drops.
export function isSpotActive(spot: Pick<Spot, "status">): boolean {
  return spotStatus(spot) === "active";
}

// Merchant can toggle it back on themselves ONLY when they were the one who
// turned it off (paused). Admin-suspended spots need an admin to restore.
export function merchantCanReactivate(spot: Pick<Spot, "status">): boolean {
  return spotStatus(spot) === "paused";
}

export const SPOT_STATUS_META: Record<SpotStatus, { label: string; emoji: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  active:    { label: "Live",              emoji: "🟢", tone: "good" },
  pending:   { label: "Awaiting approval", emoji: "🕓", tone: "warn" },
  paused:    { label: "Paused by you",     emoji: "⏸️", tone: "muted" },
  suspended: { label: "Suspended by admin", emoji: "🚫", tone: "bad" },
  rejected:  { label: "Not approved",      emoji: "❌", tone: "bad" },
};
