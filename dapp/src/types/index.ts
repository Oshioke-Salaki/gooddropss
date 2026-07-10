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

export interface SpotPayment {
  payer:  string;
  amount: string;   // G$ wei as string (JSON-safe)
  tx:     string;
  ts:     number;
}
