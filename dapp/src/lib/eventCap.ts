import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { perPersonCap, type GdEvent } from "@/lib/events";

// Server-only. The host's "most drops one person can find" rule.
//
// Each person (identity root, so linked wallets share one count) gets a ZSet
// per event of the drops they were given a claim proof for. A proof isn't a
// claim: the transaction can fail or never be sent. So an entry older than a
// proof's lifetime is checked against the chain and kept only if this person
// really claimed that drop (then it's marked final and never checked again).

/** Older than a proof's 90 s life plus slack: either claimed or abandoned. */
const STALE_S = 150;
/** Score for an entry confirmed claimed on-chain by this person. */
const FINAL = 0;

export interface DropReader {
  /** On-chain state of a drop: whether it's claimed, and by whom. */
  (dropId: string): Promise<{ claimed: boolean; claimer: string }>;
}

export function capMessage(e: Pick<GdEvent, "title">, cap: number): string {
  return `You've reached the limit of ${cap} ${cap === 1 ? "drop" : "drops"} per person at ${e.title}. Leave the rest for others.`;
}

/**
 * Check (and with `reserve`, take) a slot under the event's per-person limit
 * for this drop. Returns null when allowed, or the message to show.
 *
 * Reserving adds first and then counts, so two requests racing for the last
 * slot can't both get it (at worst both are refused and one retries).
 */
export async function eventSlot(
  redis: Redis,
  e: GdEvent,
  root: string,
  dropId: string,
  opts: { reserve: boolean; readDrop: DropReader; rootOf: (addr: string) => Promise<string> },
): Promise<string | null> {
  const cap = perPersonCap(e);
  if (!Number.isFinite(cap)) return null;
  const key = keys.eventFound(e.id, root);
  const now = Math.floor(Date.now() / 1000);

  const raw = (await redis.zrange<(string | number)[]>(key, 0, -1, { withScores: true })) ?? [];
  const entries: { id: string; at: number }[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) entries.push({ id: String(raw[i]), at: Number(raw[i + 1]) });

  // Already holding this drop (a retry after a failed transaction): fine.
  if (entries.some((x) => x.id === dropId)) {
    if (opts.reserve) await redis.zadd(key, { score: now, member: dropId });
    return null;
  }

  // Settle stale entries: keep real finds, release abandoned proofs.
  let count = 0;
  for (const x of entries) {
    if (x.at === FINAL || now - x.at < STALE_S) { count++; continue; }
    let mine = false;
    try {
      const d = await opts.readDrop(x.id);
      mine = d.claimed && (await opts.rootOf(d.claimer)).toLowerCase() === root.toLowerCase();
    } catch {
      count++;            // can't tell right now: count it, don't hand out an extra slot
      continue;
    }
    if (mine) { count++; await redis.zadd(key, { score: FINAL, member: x.id }); }
    else await redis.zrem(key, x.id);
  }
  if (count >= cap) return capMessage(e, cap);
  if (!opts.reserve) return null;

  await redis.zadd(key, { score: now, member: dropId });
  // Keep the record a week past the end, long enough for any late claim.
  await redis.expire(key, Math.max(3600, e.endsAt + 7 * 86_400 - now));
  const after = await redis.zcard(key);
  if (after > cap) {
    await redis.zrem(key, dropId);
    return capMessage(e, cap);
  }
  return null;
}
