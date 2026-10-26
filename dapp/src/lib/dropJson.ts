import type { Drop } from "@/types";

// Drops carry bigints (id, amount), which JSON can't. The API sends them as
// decimal strings; these two functions are the only place that conversion lives.

export interface DropJson {
  id: string;
  dropper: string;
  amount: string;
  claimer: string;
  expiry: number;
  claimedAt: number;
  createdAt: number;
  status: number;
  lat: number;
  lng: number;
  hint: string;
}

export function toDropJson(d: Drop): DropJson {
  return {
    id: d.id.toString(),
    dropper: d.dropper,
    amount: d.amount.toString(),
    claimer: d.claimer,
    expiry: d.expiry,
    claimedAt: d.claimedAt,
    createdAt: d.createdAt,
    status: d.status,
    lat: d.lat,
    lng: d.lng,
    hint: d.hint,
  };
}

export function fromDropJson(j: DropJson): Drop {
  return {
    id: BigInt(j.id),
    dropper: j.dropper as `0x${string}`,
    amount: BigInt(j.amount),
    claimer: j.claimer as `0x${string}`,
    expiry: j.expiry,
    claimedAt: j.claimedAt,
    createdAt: j.createdAt,
    status: j.status,
    lat: j.lat,
    lng: j.lng,
    hint: j.hint,
  };
}
