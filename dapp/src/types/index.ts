export const DROP_STATUS = {
  Active: 0,
  Claimed: 1,
  Reclaimed: 2,
} as const;

export interface DropRaw {
  dropper:   `0x${string}`;
  amount:    bigint;
  claimer:   `0x${string}`;
  expiry:    number;
  claimedAt: number;
  createdAt: number;
  status:    number;
  lat:       number;
  lng:       number;
  hint:      string;
}

export interface Drop extends DropRaw {
  id: bigint;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Campaign {
  id:                  string;
  name:                string;
  description:         string;
  color:               string;
  logo?:               string;
  ownerAddress:        string;
  createdAt:           number;
  goodcollectivePool?: string;
}

export interface HunterStreak {
  current:  number;
  best:     number;
  lastDate: string; // "YYYY-MM-DD"
}

export interface ChainStop {
  lat:    number | null;
  lng:    number | null;
  place:  string | null;
  amount: string;
  clue:   string;
}

// ── GoodSpots: merchants that accept G$ at a physical location ────────────────

export interface Spot {
  id:           string;
  name:         string;
  description:  string;
  category:     string;        // e.g. "food", "retail", "services"
  discount:     string;        // human-readable offer, e.g. "10% off with G$"
  wallet:       string;        // address that receives G$ payments
  ownerAddress: string;        // who registered the spot
  lat:          number;        // degrees
  lng:          number;        // degrees
  createdAt:    number;        // unix seconds
}

// Admin-curated place labels — the "map skeleton" for areas the base tiles leave
// blank. Neutral orientation anchors (distinct from commercial Spots).
export type LandmarkCategory =
  | "landmark" | "campus" | "school" | "market" | "worship"
  | "junction" | "estate" | "park" | "transport";

export interface Landmark {
  id:        string;
  name:      string;
  category:  LandmarkCategory;
  lat:       number;            // degrees
  lng:       number;            // degrees
  createdBy: string;            // wallet that created/suggested it (lowercased)
  createdAt: number;            // unix seconds
  updatedAt: number;            // unix seconds
  // active  = live on the map (admin-created, or a suggestion approved)
  // pending = a hunter's suggestion awaiting admin review (never on the map)
  // hidden  = admin took it off the map without deleting
  status:    "active" | "hidden" | "pending";
  note?:     string;
}

export interface SpotPayment {
  payer:  string;
  amount: string;   // G$ wei as string (JSON-safe)
  tx:     string;
  ts:     number;
}
