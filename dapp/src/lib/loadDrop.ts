// Browser: load one drop for the drop page and its sticker.
//
// Asks our API (indexer + contract, cached), and only if our server can't be
// reached reads the contract directly, so a page never fails just because one
// path is down. Resolves null when the drop doesn't exist; throws only when
// neither path answers.

import { fromDropJson, type DropJson } from "@/lib/dropJson";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import type { Drop } from "@/types";

export async function loadDrop(id: string, opts: { fresh?: boolean } = {}): Promise<Drop | null> {
  try {
    const res = await fetch(`/api/drops/${encodeURIComponent(id)}${opts.fresh ? "?fresh=1" : ""}`,
      opts.fresh ? { cache: "no-store" } : undefined);
    if (res.status === 404) return null;
    if (res.ok) return fromDropJson(((await res.json()) as { drop: DropJson }).drop);
  } catch { /* our server unreachable: read the contract below */ }

  if (!/^\d{1,30}$/.test(id)) return null;
  const r = await publicClient.readContract({
    address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(id)],
  });
  // Unknown ids come back as an all-zero struct, not a revert.
  if (/^0x0{40}$/i.test(r.dropper)) return null;
  return {
    id: BigInt(id),
    dropper: r.dropper,
    amount: BigInt(r.amount),
    claimer: r.claimer,
    expiry: Number(r.expiry),
    claimedAt: Number(r.claimedAt),
    createdAt: 0,
    status: Number(r.status),
    lat: Number(r.lat),
    lng: Number(r.lng),
    hint: r.hint,
  };
}
