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
