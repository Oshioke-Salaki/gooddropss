import { randomBytes } from "crypto";
import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { spotStatus, SPOT_STATUSES } from "@/lib/spotStatus";
import type { Spot, SpotStatus } from "@/types";

// Server-only storage for GoodSpots. Every shop sits in exactly one status
// index (a ZSet scored by createdAt), so the public map reads ONLY live shops,
// however many pending or rejected sign-ups exist. The legacy `spotsAll` list
// is still appended to, purely so the indexes can be rebuilt from it.

const parse = (raw: unknown): Spot | null => {
  if (!raw) return null;
  try { return (typeof raw === "string" ? JSON.parse(raw) : raw) as Spot; } catch { return null; }
};

export async function getSpot(redis: Redis, id: string): Promise<Spot | null> {
  if (!id || id.length > 64) return null;
  return parse(await redis.get(keys.spot(id)));
}

export async function getSpots(redis: Redis, ids: string[]): Promise<Spot[]> {
  const out: Spot[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const raw = await redis.mget<unknown[]>(...chunk.map((id) => keys.spot(id)));
    for (const r of raw) { const s = parse(r); if (s) out.push(s); }
  }
  return out;
}

/** Write a shop and move it into the index for its current status, in one pipeline. */
export async function saveSpot(redis: Redis, spot: Spot): Promise<void> {
  const cur = spotStatus(spot);
  const p = redis.pipeline();
  p.set(keys.spot(spot.id), JSON.stringify(spot));
  for (const s of SPOT_STATUSES) if (s !== cur) p.zrem(keys.spotsByStatus(s), spot.id);
  p.zadd(keys.spotsByStatus(cur), { score: spot.createdAt, member: spot.id });
  await p.exec();
}

/** Remove a shop and every index that references it. */
export async function deleteSpot(redis: Redis, spot: Spot): Promise<void> {
  const p = redis.pipeline();
  p.del(keys.spot(spot.id));
  p.lrem(keys.spotsAll(), 0, spot.id);
  if (spot.ownerAddress) p.lrem(keys.spotsByOwner(spot.ownerAddress), 0, spot.id);
  for (const s of SPOT_STATUSES) p.zrem(keys.spotsByStatus(s), spot.id);
  p.del(keys.spotPayments(spot.id));
  p.del(keys.spotPayStats(spot.id));
  await p.exec();
}

/**
 * Build the status indexes from the legacy list, once. Safe to call on every
 * request: after the first run it's a single GET. Returns false while another
 * request holds the build lock (callers fall back to the legacy list).
 */
export async function ensureSpotIndex(redis: Redis): Promise<boolean> {
  if (await redis.get(keys.spotsIndexReady())) return true;
  const got = await redis.set(keys.spotsIndexLock(), "1", { nx: true, ex: 60 });
  if (got === null) return false;
  try {
    const ids = (await redis.lrange<string>(keys.spotsAll(), 0, -1)) ?? [];
    const spots = await getSpots(redis, [...new Set(ids)]);
    for (let i = 0; i < spots.length; i += 100) {
      const p = redis.pipeline();
      for (const s of spots.slice(i, i + 100)) {
        p.zadd(keys.spotsByStatus(spotStatus(s)), { score: s.createdAt ?? 0, member: s.id });
      }
      await p.exec();
    }
    await redis.set(keys.spotsIndexReady(), String(Date.now()));
    return true;
  } finally {
    await redis.del(keys.spotsIndexLock()).catch(() => {});
  }
}

/** Shops with the given statuses, newest first. */
export async function listSpots(redis: Redis, statuses: SpotStatus[], limit = 2000): Promise<Spot[]> {
  if (!(await ensureSpotIndex(redis))) {
    // Index is being built right now: read the legacy list for this one request.
    const ids = (await redis.lrange<string>(keys.spotsAll(), 0, -1)) ?? [];
    const all = await getSpots(redis, [...new Set(ids)]);
    return all.filter((s) => statuses.includes(spotStatus(s))).slice(0, limit);
  }
  const ids: string[] = [];
  for (const s of statuses) {
    ids.push(...((await redis.zrange<string[]>(keys.spotsByStatus(s), 0, limit - 1, { rev: true })) ?? []));
  }
  const spots = await getSpots(redis, ids);
  return spots.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, limit);
}

/** Count of shops in a status (e.g. how many sign-ups await review). */
export async function countSpots(redis: Redis, status: SpotStatus): Promise<number> {
  await ensureSpotIndex(redis);
  return (await redis.zcard(keys.spotsByStatus(status))) ?? 0;
}

/**
 * Run a read-modify-write on one shop under a short lock, so an admin approving
 * and a merchant pausing at the same moment can't overwrite each other. Returns
 * null when the shop is busy (caller answers 409).
 */
export async function withSpotLock<T>(redis: Redis, id: string, fn: () => Promise<T>): Promise<T | null> {
  // Prefixed so Upstash never auto-parses an all-digit token into a number.
  const token = `lock:${randomBytes(8).toString("hex")}`;
  const got = await redis.set(keys.spotLock(id), token, { nx: true, px: 10_000 });
  if (got === null) return null;
  try {
    return await fn();
  } finally {
    // Release only our own lock (it may have expired and been retaken).
    const held = await redis.get<string>(keys.spotLock(id)).catch(() => null);
    if (held === token) await redis.del(keys.spotLock(id)).catch(() => {});
  }
}

/** What anyone may see about a shop that isn't live: enough to say so, nothing to pay. */
export function unavailableSpot(s: Spot): Spot {
  return {
    id: s.id, name: s.name, description: s.description, category: s.category, discount: "",
    wallet: "", ownerAddress: "", lat: s.lat, lng: s.lng,
    ...(s.placeName ? { placeName: s.placeName } : {}),
    createdAt: s.createdAt, status: spotStatus(s),
  };
}

/** A live shop as the public sees it: no admin note, no owner phone number. */
export function publicSpot(s: Spot): Spot {
  const { note: _note, contact: _contact, ...rest } = s;
  return rest;
}
