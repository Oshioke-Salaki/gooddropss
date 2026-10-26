import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { fetchEventDrops } from "@/lib/subgraph";
import { resolveRoots } from "@/lib/roots";
import { memo } from "@/lib/serverCache";
import { computeEventStats, eventIdOf, EMPTY_STATS, type EventStats, type GdEvent } from "@/lib/events";
import type { Drop } from "@/types";

// Server-side reads and writes for events. Pure rules live in lib/events.

const parse = (raw: unknown): GdEvent | null => {
  if (!raw) return null;
  try { return (typeof raw === "string" ? JSON.parse(raw) : raw) as GdEvent; } catch { return null; }
};

export async function getEvent(redis: Redis, id: string): Promise<GdEvent | null> {
  return parse(await redis.get(keys.event(id)));
}

export async function getEvents(redis: Redis, ids: string[]): Promise<GdEvent[]> {
  if (ids.length === 0) return [];
  const raws = await redis.mget<unknown[]>(...ids.map((id) => keys.event(id)));
  return raws.map(parse).filter((e): e is GdEvent => !!e);
}

/**
 * Write an event and keep every index consistent with its status in one
 * pipeline: public listing only while approved, review queue while there's
 * something to review, host index for every host (old hosts removed).
 */
export async function saveEvent(redis: Redis, e: GdEvent, previous?: GdEvent | null): Promise<void> {
  const p = redis.pipeline();
  p.set(keys.event(e.id), JSON.stringify(e));
  p.zadd(keys.eventsAll(), { score: e.createdAt, member: e.id });

  if (e.status === "approved") p.zadd(keys.eventsPublic(), { score: e.startsAt, member: e.id });
  else p.zrem(keys.eventsPublic(), e.id);

  if (e.status === "pending" || e.pendingEdit) p.sadd(keys.eventsReview(), e.id);
  else p.srem(keys.eventsReview(), e.id);

  const hosts = new Set([e.organizer, ...e.cohosts]);
  for (const h of hosts) p.sadd(keys.eventsByHost(h), e.id);
  if (previous) {
    for (const h of [previous.organizer, ...previous.cohosts]) {
      if (!hosts.has(h)) p.srem(keys.eventsByHost(h), e.id);
    }
  }
  await p.exec();
}

// ── Live stats ────────────────────────────────────────────────────────────────

/** Every event-tagged drop, grouped by event id. One subgraph scan for all events. */
async function dropsByEvent(): Promise<Map<string, Drop[]>> {
  return memo("events:drops", 15_000, async () => {
    const drops = await fetchEventDrops();
    const out = new Map<string, Drop[]>();
    for (const d of drops) {
      const id = eventIdOf(d.hint);
      if (!id) continue;
      const list = out.get(id);
      if (list) list.push(d); else out.set(id, [d]);
    }
    return out;
  });
}

/** Stats for each event (identity-scoped hunter counts). Missing events get zeros. */
export async function statsFor(events: GdEvent[], now = Math.floor(Date.now() / 1000)): Promise<Map<string, EventStats>> {
  const out = new Map<string, EventStats>();
  if (events.length === 0) return out;
  let grouped: Map<string, Drop[]>;
  try {
    grouped = await dropsByEvent();
  } catch (e) {
    console.error("[events/stats]", e);
    for (const ev of events) out.set(ev.id, EMPTY_STATS);
    return out;
  }
  const claimers = new Set<string>();
  for (const ev of events) for (const d of grouped.get(ev.id) ?? []) if (d.claimedAt) claimers.add(d.claimer.toLowerCase());
  const roots = claimers.size ? await resolveRoots([...claimers]) : new Map<string, string>();
  const rootOf = (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase();
  for (const ev of events) out.set(ev.id, computeEventStats(ev, grouped.get(ev.id) ?? [], now, rootOf));
  return out;
}

/** The event a drop belongs to (null when untagged or unknown). */
export async function eventForHint(redis: Redis, hint: string): Promise<GdEvent | null> {
  const id = eventIdOf(hint);
  return id ? getEvent(redis, id) : null;
}
