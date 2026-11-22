// Cities for the weekly city-vs-city board. A drop belongs to the nearest city
// whose radius it falls inside; anything else is "elsewhere" and isn't ranked.
//
// The list is drawn from where drops actually are (Lafia, Kaduna and Hyderabad
// lead), plus Nigeria's big cities so a new scene shows up the week it starts.
// Coordinates are city centres; radii cover the city and its near suburbs.

import { DROP_STATUS, type Drop } from "@/types";
import { gpsToDeg, haversineDistance } from "@/lib/utils";

export interface City {
  id: string;
  name: string;
  /** Country, for the flag-free label under the name. */
  country: string;
  lat: number;
  lng: number;
  /** Radius in km. */
  km: number;
}

export const CITIES: City[] = [
  { id: "lafia", name: "Lafia", country: "Nigeria", lat: 8.49, lng: 8.52, km: 30 },
  { id: "kaduna", name: "Kaduna", country: "Nigeria", lat: 10.52, lng: 7.44, km: 30 },
  { id: "hyderabad", name: "Hyderabad", country: "India", lat: 17.39, lng: 78.49, km: 45 },
  { id: "lagos", name: "Lagos", country: "Nigeria", lat: 6.52, lng: 3.38, km: 45 },
  { id: "makurdi", name: "Makurdi", country: "Nigeria", lat: 7.73, lng: 8.54, km: 25 },
  { id: "abuja", name: "Abuja", country: "Nigeria", lat: 9.06, lng: 7.49, km: 35 },
  { id: "gwagwalada", name: "Gwagwalada", country: "Nigeria", lat: 8.94, lng: 7.08, km: 20 },
  { id: "keffi", name: "Keffi", country: "Nigeria", lat: 8.85, lng: 7.87, km: 20 },
  { id: "zaria", name: "Zaria", country: "Nigeria", lat: 11.08, lng: 7.71, km: 25 },
  { id: "minna", name: "Minna", country: "Nigeria", lat: 9.61, lng: 6.55, km: 25 },
  { id: "lokoja", name: "Lokoja", country: "Nigeria", lat: 7.8, lng: 6.74, km: 30 },
  { id: "uyo", name: "Uyo", country: "Nigeria", lat: 5.04, lng: 7.93, km: 25 },
  { id: "calabar", name: "Calabar", country: "Nigeria", lat: 4.95, lng: 8.32, km: 20 },
  { id: "gboko", name: "Gboko", country: "Nigeria", lat: 7.32, lng: 9.0, km: 20 },
  { id: "jos", name: "Jos", country: "Nigeria", lat: 9.9, lng: 8.86, km: 25 },
  { id: "kano", name: "Kano", country: "Nigeria", lat: 12.0, lng: 8.52, km: 30 },
  { id: "port-harcourt", name: "Port Harcourt", country: "Nigeria", lat: 4.82, lng: 7.03, km: 30 },
  { id: "ibadan", name: "Ibadan", country: "Nigeria", lat: 7.38, lng: 3.9, km: 30 },
  { id: "enugu", name: "Enugu", country: "Nigeria", lat: 6.44, lng: 7.5, km: 25 },
  { id: "benin-city", name: "Benin City", country: "Nigeria", lat: 6.34, lng: 5.63, km: 25 },
  { id: "nairobi", name: "Nairobi", country: "Kenya", lat: -1.29, lng: 36.82, km: 35 },
  { id: "paris", name: "Paris", country: "France", lat: 48.86, lng: 2.35, km: 35 },
  { id: "new-york", name: "New York", country: "United States", lat: 40.71, lng: -74.0, km: 45 },
];

/** The city a point belongs to (nearest centre within its radius), or null. */
export function cityAt(lat: number, lng: number): City | null {
  let best: City | null = null;
  let bestM = Infinity;
  for (const c of CITIES) {
    const m = haversineDistance(lat, lng, c.lat, c.lng);
    if (m <= c.km * 1000 && m < bestM) { best = c; bestM = m; }
  }
  return best;
}

/** The city a drop is in. Private drops (stored at 0,0) have none. */
export function cityOfDrop(d: Pick<Drop, "lat" | "lng">): City | null {
  if (d.lat === 0 && d.lng === 0) return null;
  return cityAt(gpsToDeg(d.lat), gpsToDeg(d.lng));
}

/** /api/board/cities response (wei as strings: JSON has no bigint). */
export interface CityBoardJson {
  week: { start: number; end: number };
  rows: (Omit<CityRow, "foundWei"> & { foundWei: string })[];
  at: number;
}

export interface CityRow {
  id: string;
  name: string;
  country: string;
  /** G$ found (claimed) in the city this week, in wei. */
  foundWei: bigint;
  claims: number;
  /** Different people who found something (by identity). */
  hunters: number;
  /** Drops hidden in the city this week. */
  hidden: number;
}

/**
 * This week's board: per city, G$ found, finds, hunters and drops hidden inside
 * [start, end). Ranked by G$ found, then finds, then name. Cities with nothing
 * this week are left out. Pure.
 */
export function cityBoard(drops: Drop[], rootOf: (wallet: string) => string, week: { start: number; end: number }): CityRow[] {
  const inWeek = (t: number) => t >= week.start && t < week.end;
  const rows = new Map<string, CityRow & { people: Set<string> }>();
  const row = (c: City) => {
    let r = rows.get(c.id);
    if (!r) { r = { id: c.id, name: c.name, country: c.country, foundWei: 0n, claims: 0, hunters: 0, hidden: 0, people: new Set() }; rows.set(c.id, r); }
    return r;
  };
  for (const d of drops) {
    const found = d.status === DROP_STATUS.Claimed && inWeek(d.claimedAt);
    const hidden = inWeek(d.createdAt);
    if (!found && !hidden) continue;
    const c = cityOfDrop(d);
    if (!c) continue;
    const r = row(c);
    if (hidden) r.hidden++;
    if (found) { r.foundWei += d.amount; r.claims++; r.people.add(rootOf(d.claimer)); }
  }
  return [...rows.values()]
    .map(({ people, ...r }) => ({ ...r, hunters: people.size }))
    .sort((a, b) => (b.foundWei > a.foundWei ? 1 : b.foundWei < a.foundWei ? -1 : b.claims - a.claims || a.name.localeCompare(b.name)));
}

/** "Resets in 3 days" / "Resets tomorrow" / "Resets in 5 hours". */
export function resetsIn(endsAt: number, nowS = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, endsAt - nowS);
  const days = Math.floor(s / 86_400);
  if (days >= 2) return `Resets in ${days} days`;
  if (days === 1) return "Resets tomorrow";
  const hours = Math.max(1, Math.round(s / 3_600));
  return `Resets in ${hours} hour${hours === 1 ? "" : "s"}`;
}
