import { keccak256, toBytes } from "viem";

// What a merchant signs to act on a shop. Shared by the client and the server
// so both build the exact same text. Each message is bound to the action, the
// shop, a digest of the exact content, and the time, so a signature can't be
// replayed for another action, another shop, or different details.

export type SpotAction = "register" | "edit" | "pause" | "reactivate";

export const SPOT_CATEGORIES = ["food", "retail", "services", "transport", "other"] as const;

/** The fields a merchant fills in when registering a shop, normalized. */
export interface SpotDraft {
  name: string;
  description: string;
  category: string;
  discount: string;
  wallet: string;
  lat: number;
  lng: number;
  placeName: string;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Normalize registration fields exactly as the server stores them. */
export function normalizeSpotDraft(d: Record<string, unknown>): SpotDraft {
  return {
    name: str(d.name, 60),
    description: str(d.description, 280),
    category: typeof d.category === "string" && d.category ? d.category : "other",
    discount: str(d.discount, 80),
    wallet: typeof d.wallet === "string" ? d.wallet.trim().toLowerCase() : "",
    lat: Number(d.lat),
    lng: Number(d.lng),
    placeName: str(d.placeName, 80),
  };
}

const PATCH_FIELDS = ["name", "description", "category", "discount", "wallet", "lat", "lng", "placeName"] as const;

/**
 * The editable fields present in a PATCH body, normalized the same way the
 * server applies them. Fields that aren't sent aren't signed or changed.
 */
export function pickSpotPatch(body: Record<string, unknown>): Partial<SpotDraft> {
  const out: Record<string, string | number> = {};
  for (const k of PATCH_FIELDS) {
    const v = body[k];
    if (v === undefined) continue;
    if (k === "lat" || k === "lng") out[k] = Number(v);
    else if (k === "wallet") out[k] = String(v).trim().toLowerCase();
    else if (k === "category") out[k] = String(v);
    else out[k] = String(v).trim().slice(0, k === "description" ? 280 : k === "name" ? 60 : 80);
  }
  return out as Partial<SpotDraft>;
}

/** Short, stable digest of the content being signed ("none" for status actions). */
export function spotDigest(content: Partial<SpotDraft> | null): string {
  if (!content) return "none";
  const entries = Object.entries(content).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return keccak256(toBytes(JSON.stringify(entries))).slice(0, 18);
}

/** `spotId` is "new" when registering. */
export function spotMessage(action: SpotAction, spotId: string, timestamp: number, digest: string): string {
  return `GoodDrops shop\nAction: ${action}\nShop: ${spotId}\nContent: ${digest}\nTime: ${timestamp}`;
}
