import { haversineDistance } from "@/lib/utils";

/**
 * How many drops each landmark should claim.
 *
 * Every drop goes to its single NEAREST landmark within `radiusM`, so the
 * counts on the map always add up to the real number of drops. Counting
 * "everything within radius" per landmark double-counted any drop sitting
 * between two nearby places (two pills saying "2" for 2 drops in total).
 */
export function countDropsPerLandmark(
  drops: { lat: number; lng: number }[],
  landmarks: { id: string; lat: number; lng: number }[],
  radiusM: number,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of drops) {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const l of landmarks) {
      const dist = haversineDistance(l.lat, l.lng, d.lat, d.lng);
      // Ties go to the earlier landmark in the list, so the result is stable.
      if (dist <= radiusM && dist < bestDist) { best = l.id; bestDist = dist; }
    }
    if (best) counts.set(best, (counts.get(best) ?? 0) + 1);
  }
  return counts;
}
