// A server-side mirror of every drop, kept current with tiny "what changed"
// queries instead of re-downloading the whole table.
//
// Why: the full drop table is ~11k rows, 12 requests and ~19 s to page through,
// and Goldsky's Starter plan allows 20 requests per 10 s for the whole project.
// Profiles, rankings, stats, quests, events and the map all need drops, so each
// of them re-scanning everything was slow, burnt the rate limit, and grew with
// every new drop.
//
// How:
//   1. Load once per server instance: from a compressed snapshot in Redis when a
//      recent one exists (one read), else by paging the subgraph (cursor on id).
//   2. Refresh with ONE request: `_change_block: { number_gte: B }` returns only
//      drops created or updated at or after block B (graph-node's change filter).
//   3. Everything else filters the mirror in memory: zero extra requests.
//
// Safety:
//   • Concurrent callers share one sync; a failed sync serves the last good copy.
//   • `fresh` (after a claim) can't force syncs faster than every 2 s.
//   • A full reload every hour, or if the indexer's block goes backwards (a
//     redeploy), so the mirror can't drift. It runs in the background: readers
//     keep getting the current copy and never wait for it.
//   • Indexer lag is measured against the chain; when the indexer has stalled,
//     callers that must be right (the map, a drop page) patch from the contract.

import { gzipSync, gunzipSync } from "node:zlib";
import type { Drop } from "@/types";
import { gql } from "@/lib/subgraphClient";

const FIELDS = "id dropId dropper amount claimer expiry claimedAt createdAt status lat lng hint";

export interface SubgraphDrop {
  id: string; dropId: string; dropper: string; amount: string; claimer: string;
  expiry: string; claimedAt: string; createdAt: string; status: number;
  lat: number; lng: number; hint: string;
}

export function toDrop(d: SubgraphDrop): Drop {
  return {
    id: BigInt(d.dropId),
    dropper: d.dropper as `0x${string}`,
    amount: BigInt(d.amount),
    claimer: d.claimer as `0x${string}`,
    expiry: Number(d.expiry),
    claimedAt: Number(d.claimedAt),
    createdAt: Number(d.createdAt),
    status: d.status,
    lat: d.lat,
    lng: d.lng,
    hint: d.hint,
  };
}

/** How old the mirror may be before a read refreshes it. */
const SYNC_MS = 10_000;
/** `fresh` reads still share any sync from the last 2 s (stops refresh loops). */
const FRESH_FLOOR_MS = 2_000;
/** Reload everything this often, as a guard against any drift. */
const FULL_RESYNC_MS = 60 * 60_000;
/**
 * A Redis snapshot older than this isn't used to start from. Any age within it
 * is safe: the change query from its block brings it fully up to date.
 */
const SNAPSHOT_MAX_AGE_MS = 24 * 3600_000;
/** Save a new snapshot at most this often (per instance). */
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const SNAPSHOT_KEY = "gd:mirror:drops:v1";
/** Hard stop on paging: 200k drops. */
const MAX_PAGES = 200;

interface State {
  byId: Map<string, Drop>;
  list: Drop[];
  /** Subgraph block the mirror reflects. */
  block: number;
  syncedAt: number;
  savedAt: number;
}

let state: State | null = null;
let syncing: Promise<State> | null = null;
/** When the data last came from a full reload (not from deltas). */
let lastFullAt = 0;
let fullReloading: Promise<void> | null = null;

type Page = { _meta: { block: { number: number } }; drops: SubgraphDrop[] };

/** Page through drops (cursor on id) with an optional extra filter. */
async function pageDrops(extraWhere: string, vars: Record<string, unknown>, varDecl: string): Promise<{ rows: SubgraphDrop[]; block: number }> {
  const query = `query Q($lastId: ID!${varDecl}) {
    _meta { block { number } }
    drops(first: 1000, orderBy: id, orderDirection: asc, where: { id_gt: $lastId${extraWhere} }) { ${FIELDS} }
  }`;
  const rows: SubgraphDrop[] = [];
  let lastId = "";
  let block = -1;
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await gql<Page>(query, { lastId, ...vars }, { timeoutMs: 15_000 });
    // The first page's block is the safe one to resume from: anything that
    // changes while we page is picked up again by the next delta (>= block).
    if (block < 0) block = page._meta.block.number;
    rows.push(...page.drops);
    if (page.drops.length < 1000) return { rows, block };
    lastId = page.drops[page.drops.length - 1].id;
  }
  throw new Error("drop mirror: too many pages");
}

function build(byId: Map<string, Drop>, block: number, savedAt: number): State {
  // Sorted by id so callers get a stable order (oldest first).
  const list = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { byId, list, block, syncedAt: Date.now(), savedAt };
}

async function fullFromSubgraph(): Promise<State> {
  const { rows, block } = await pageDrops("", {}, "");
  const byId = new Map<string, Drop>();
  for (const r of rows) byId.set(r.dropId, toDrop(r));
  const s = build(byId, block, 0);
  lastFullAt = Date.now();
  void saveSnapshot(s);
  return s;
}

/** Full reload without making anyone wait: readers keep the current copy. */
function reloadInBackground(): void {
  fullReloading ??= fullFromSubgraph()
    .then((s) => { state = s; })
    .catch((e) => console.warn("[drop-mirror] background reload failed:", (e as Error).message))
    .finally(() => { fullReloading = null; });
}

async function delta(prev: State): Promise<State> {
  const { rows, block } = await pageDrops(", _change_block: { number_gte: $b }", { b: prev.block }, ", $b: Int!");
  // The indexer went backwards (redeployed or rewound): our copy is still the
  // best we have; rebuild from the new deployment in the background.
  if (block < prev.block - 50) {
    reloadInBackground();
    return { ...prev, syncedAt: Date.now() };
  }
  if (rows.length === 0) {
    const s = { ...prev, block: Math.max(prev.block, block), syncedAt: Date.now() };
    if (Date.now() - s.savedAt > SNAPSHOT_EVERY_MS && s.block > prev.block) void saveSnapshot(s);
    return s;
  }
  const byId = new Map(prev.byId);
  for (const r of rows) byId.set(r.dropId, toDrop(r));
  const s = build(byId, Math.max(prev.block, block), prev.savedAt);
  if (Date.now() - s.savedAt > SNAPSHOT_EVERY_MS) void saveSnapshot(s);
  return s;
}

async function sync(): Promise<State> {
  syncing ??= (async () => {
    try {
      let next: State;
      if (state) {
        if (Date.now() - lastFullAt > FULL_RESYNC_MS) reloadInBackground();
        next = await delta(state);
      } else {
        // Cold: start from Redis (one read + one change query) when we can;
        // only a first-ever start pages through every drop.
        const snap = await loadSnapshot();
        next = snap ? await delta(snap) : await fullFromSubgraph();
      }
      state = next;
      return next;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/**
 * Every drop ever made, oldest first, at most ~10 s old (2 s with `fresh`).
 * Server only. Throws only if there's no copy at all and the subgraph is down;
 * otherwise a failed refresh returns the last good copy.
 */
export async function mirrorDrops({ fresh = false }: { fresh?: boolean } = {}): Promise<Drop[]> {
  if (typeof window !== "undefined") throw new Error("mirrorDrops is server-only");
  if (state && Date.now() - state.syncedAt < (fresh ? FRESH_FLOOR_MS : SYNC_MS)) return state.list;
  try {
    return (await sync()).list;
  } catch (e) {
    if (state) {
      console.warn("[drop-mirror] refresh failed, serving last copy:", (e as Error).message);
      return state.list;
    }
    throw e;
  }
}

/** Is the mirror loaded on this instance? (No request.) */
export function mirrorReady(): boolean {
  return state !== null;
}

/** A drop from the mirror, if it's loaded on this instance (no request). */
export function mirrorPeek(id: string): Drop | undefined {
  return state?.byId.get(id);
}

/** Highest drop id the mirror knows, and the subgraph block it reflects. */
export function mirrorInfo(): { maxId: bigint; block: number; syncedAt: number; size: number } | null {
  if (!state) return null;
  const last = state.list[state.list.length - 1];
  return { maxId: last ? last.id : 0n, block: state.block, syncedAt: state.syncedAt, size: state.list.length };
}

// ─── Redis snapshot (so a cold instance starts with one read, not 12 requests) ─

type SnapRow = [string, string, string, string, number, number, number, number, number, number, string];

function encode(s: State): string {
  const rows: SnapRow[] = s.list.map((d) => [
    d.id.toString(), d.dropper, d.amount.toString(), d.claimer,
    d.expiry, d.claimedAt, d.createdAt, d.status, d.lat, d.lng, d.hint,
  ]);
  // `at` = when this data was fetched (not when it's written), so a slow save
  // can never make old data look recent.
  return gzipSync(JSON.stringify({ v: 1, block: s.block, at: s.syncedAt, rows })).toString("base64");
}

function decode(b64: string): { block: number; at: number; byId: Map<string, Drop> } | null {
  const j = JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8")) as { v: number; block: number; at: number; rows: SnapRow[] };
  if (j.v !== 1 || !Array.isArray(j.rows) || !(j.block > 0)) return null;
  const byId = new Map<string, Drop>();
  for (const r of j.rows) {
    byId.set(r[0], {
      id: BigInt(r[0]), dropper: r[1] as `0x${string}`, amount: BigInt(r[2]), claimer: r[3] as `0x${string}`,
      expiry: r[4], claimedAt: r[5], createdAt: r[6], status: r[7], lat: r[8], lng: r[9], hint: r[10],
    });
  }
  return { block: j.block, at: j.at, byId };
}

async function redisClient() {
  try { return (await import("@/lib/redis")).getRedis(); } catch { return null; }
}

async function loadSnapshot(): Promise<State | null> {
  const redis = await redisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>(SNAPSHOT_KEY);
    if (typeof raw !== "string") return null;
    const snap = decode(raw);
    if (!snap || Date.now() - snap.at > SNAPSHOT_MAX_AGE_MS) return null;
    // Counts as a full load as of when its data was fetched, so the hourly
    // background reload still happens on schedule.
    lastFullAt = snap.at;
    return build(snap.byId, snap.block, Date.now());
  } catch (e) {
    console.warn("[drop-mirror] snapshot unreadable, loading from subgraph:", (e as Error).message);
    return null;
  }
}

async function saveSnapshot(s: State): Promise<void> {
  s.savedAt = Date.now();
  const redis = await redisClient();
  if (!redis) return;
  try {
    await redis.set(SNAPSHOT_KEY, encode(s), { ex: 24 * 3600 });
  } catch (e) {
    console.warn("[drop-mirror] snapshot not saved:", (e as Error).message);
  }
}

/** Test hook: the encoder/decoder pair. */
export const __snapshotCodec = { encode: (list: Drop[], block: number) => encode(build(new Map(list.map((d) => [d.id.toString(), d])), block, 0)), decode };
