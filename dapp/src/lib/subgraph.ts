// Drop data for the server, from the Goldsky subgraph. SERVER ONLY: browsers
// go through our API routes (cached, rate-limit safe), never to Goldsky.
//
// Most reads come from the in-memory drop mirror (lib/dropMirror): kept current
// with one small "what changed" request, so a profile, the rankings or a quest
// no longer pages through every drop ever made.
//
// Screens that must answer fast (the map, My Drops, the ticker, referral checks)
// use `quick()`: the mirror if it's loaded; on a cold server, a hedged request:
// the small targeted query they always used runs alongside the mirror's load and
// the first good answer wins, so nobody ever waits for a full load.

import type { Drop } from "@/types";
import { resolveRoots } from "@/lib/roots";
import { memo } from "@/lib/serverCache";
import { gql } from "@/lib/subgraphClient";
import { mirrorDrops, mirrorPeek, mirrorReady, toDrop, type SubgraphDrop } from "@/lib/dropMirror";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const FIELDS = "id dropId dropper amount claimer expiry claimedAt createdAt status lat lng hint";
const ADDR_RE = /^0x[0-9a-f]{40}$/;

function serverOnly(fn: string) {
  if (typeof window !== "undefined") throw new Error(`${fn} is server-only; call an /api route instead`);
}

/**
 * Mirror if loaded. Cold: start the mirror's load (shared, it keeps going for
 * the next caller) AND the direct query; the first to succeed answers. Fails
 * only if both fail, with the direct query's error.
 */
async function quick<T>(fromMirror: (all: Drop[]) => T, direct: () => Promise<T>, fresh = false): Promise<T> {
  if (mirrorReady()) return fromMirror(await mirrorDrops({ fresh }));
  try {
    return await Promise.any([mirrorDrops().then(fromMirror), direct()]);
  } catch (e) {
    const errs = (e as AggregateError).errors ?? [e];
    throw errs[errs.length - 1];
  }
}

/** Page a filtered query (cursor on id). Used only while the mirror is cold. */
async function directWhere(where: string, vars: Record<string, string>): Promise<Drop[]> {
  const varDecl = Object.keys(vars).map((k) => `, $${k}: String!`).join("");
  const query = `query Q($lastId: ID!${varDecl}) {
    drops(first: 1000, orderBy: id, orderDirection: asc, where: { id_gt: $lastId, ${where} }) { ${FIELDS} }
  }`;
  const out: Drop[] = [];
  let lastId = "";
  for (let page = 0; page < 50; page++) {
    const { drops } = await gql<{ drops: SubgraphDrop[] }>(query, { lastId, ...vars });
    out.push(...drops.map(toDrop));
    if (drops.length < 1000) break;
    lastId = drops[drops.length - 1].id;
  }
  return out;
}

// ─── One drop ────────────────────────────────────────────────────────────────

/**
 * One drop by its on-chain id (the subgraph's entity id is the same number), or
 * null if the indexer doesn't have it. From the mirror when loaded, else one
 * primary-key lookup. Throws only on a subgraph failure.
 */
export async function fetchDropById(id: string): Promise<Drop | null> {
  serverOnly("fetchDropById");
  if (!/^\d{1,30}$/.test(id)) return null;
  const hit = mirrorPeek(id);
  if (hit) return hit;
  const { drop } = await gql<{ drop: SubgraphDrop | null }>(`query D($id: ID!) { drop(id: $id) { ${FIELDS} } }`, { id }, { timeoutMs: 6_000 });
  return drop ? toDrop(drop) : null;
}

/** Same as fetchDropById, never throws (null when unknown or unreachable). */
export async function fetchDropByDropId(dropId: string): Promise<Drop | null> {
  try { return await fetchDropById(dropId); } catch { return null; }
}

// ─── Recent activity ─────────────────────────────────────────────────────────

export interface ActivityItem {
  type: "drop" | "claim";
  id: string;
  address: string;
  amount: bigint;
  timestamp: number;
}

function toActivity(newDrops: Drop[], newClaims: Drop[]): ActivityItem[] {
  const items: ActivityItem[] = [
    ...newDrops.map((d) => ({ type: "drop" as const, id: `drop-${d.id}`, address: d.dropper, amount: d.amount, timestamp: d.createdAt })),
    ...newClaims.map((c) => ({ type: "claim" as const, id: `claim-${c.id}`, address: c.claimer, amount: c.amount, timestamp: c.claimedAt })),
  ];
  return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
}

/** The newest drops and finds, for the ticker. Empty on failure. */
export async function fetchRecentActivity(): Promise<ActivityItem[]> {
  serverOnly("fetchRecentActivity");
  try {
    return await quick(
      (all) => {
        const byNewest = (k: "id" | "claimedAt") => (a: Drop, b: Drop) =>
          k === "id" ? (b.id > a.id ? 1 : b.id < a.id ? -1 : 0) : b.claimedAt - a.claimedAt;
        const newDrops = [...all].sort(byNewest("id")).slice(0, 6);
        const newClaims = all.filter((d) => d.status === 1 && d.claimedAt > 0).sort(byNewest("claimedAt")).slice(0, 6);
        return toActivity(newDrops, newClaims);
      },
      async () => {
        const data = await gql<{ newDrops: SubgraphDrop[]; newClaims: SubgraphDrop[] }>(`{
          newDrops: drops(first: 6, orderBy: dropId, orderDirection: desc) { ${FIELDS} }
          newClaims: drops(first: 6, orderBy: claimedAt, orderDirection: desc, where: { status: 1, claimedAt_gt: "0" }) { ${FIELDS} }
        }`, {}, { timeoutMs: 6_000 });
        return toActivity(data.newDrops.map(toDrop), data.newClaims.map(toDrop));
      },
    );
  } catch {
    return [];
  }
}

// ─── Hunter profile ───────────────────────────────────────────────────────────

export interface HunterStats {
  address: string;
  dropsCreated: Drop[];
  dropsClaimed: Drop[];
}

// IDENTITY-SCOPED so the profile matches the (identity-scoped) leaderboard: a
// person's drops/claims across ALL their linked GoodDollar wallets are summed
// under one identity. Shared for 30 s per address, so the profile's stats and
// badges (two routes, opened together) build it once.
export async function fetchHunterProfile(address: string, opts: { fresh?: boolean } = {}): Promise<HunterStats | null> {
  serverOnly("fetchHunterProfile");
  const a = address.toLowerCase();
  try {
    return await memo(`hunter:${a}`, 30_000, async () => {
      const all = await mirrorDrops({ fresh: opts.fresh });
      // Resolve every participating wallet → its identity root (memory/Redis cached).
      const wallets = new Set<string>([a]);
      for (const d of all) {
        wallets.add(d.dropper.toLowerCase());
        if (d.claimer && d.claimer.toLowerCase() !== ZERO_ADDR) wallets.add(d.claimer.toLowerCase());
      }
      const roots = await resolveRoots([...wallets]);
      const rootOf = (x: string) => roots.get(x.toLowerCase()) ?? x.toLowerCase();
      const target = rootOf(a);
      const dropsCreated = all.filter((d) => rootOf(d.dropper) === target);
      const dropsClaimed = all.filter(
        (d) => d.status === 1 && d.claimer.toLowerCase() !== ZERO_ADDR && rootOf(d.claimer) === target,
      );
      return { address, dropsCreated, dropsClaimed };
    }, { fresh: opts.fresh });
  } catch {
    return null;
  }
}

// ─── Activity checks (referrals) ─────────────────────────────────────────────

/**
 * Has this wallet claimed or created a drop? Gates referral credit on real
 * activity. THROWS when the subgraph can't be reached, so callers never mistake
 * an outage for "hasn't done anything yet".
 */
export async function fetchHasActivity(address: string): Promise<boolean> {
  serverOnly("fetchHasActivity");
  const a = address.toLowerCase();
  if (!ADDR_RE.test(a)) return false;
  return quick(
    (all) => all.some((d) => d.dropper.toLowerCase() === a || (d.status === 1 && d.claimer.toLowerCase() === a)),
    async () => {
      const d = await gql<{ claimed: { id: string }[]; created: { id: string }[] }>(`query H($a: String!) {
        claimed: drops(first: 1, where: { claimer: $a, status: 1 }) { id }
        created: drops(first: 1, where: { dropper: $a }) { id }
      }`, { a }, { timeoutMs: 6_000 });
      return d.claimed.length > 0 || d.created.length > 0;
    },
  );
}

/**
 * When these wallets first did anything on GoodDrops: the earliest claim or
 * drop across all of them, in unix seconds. `null` = never active. Throws when
 * the subgraph can't be reached, so callers can tell "new" from "unknown".
 */
export async function fetchFirstActivityAt(addresses: string[]): Promise<number | null> {
  serverOnly("fetchFirstActivityAt");
  const list = [...new Set(addresses.map((x) => x.toLowerCase()))].filter((x) => ADDR_RE.test(x));
  if (!list.length) return null;
  const set = new Set(list);
  const earliest = (times: number[]) => {
    const t = times.filter((x) => Number.isFinite(x) && x > 0);
    return t.length ? Math.min(...t) : null;
  };
  return quick(
    (all) => {
      const times: number[] = [];
      for (const d of all) {
        if (d.status === 1 && set.has(d.claimer.toLowerCase())) times.push(d.claimedAt);
        if (set.has(d.dropper.toLowerCase())) times.push(d.createdAt);
      }
      return earliest(times);
    },
    async () => {
      const d = await gql<{ claimed: { claimedAt: string }[]; created: { createdAt: string }[] }>(`query F($l: [String!]!) {
        claimed: drops(first: 1, orderBy: claimedAt, orderDirection: asc, where: { claimer_in: $l, status: 1 }) { claimedAt }
        created: drops(first: 1, orderBy: createdAt, orderDirection: asc, where: { dropper_in: $l }) { createdAt }
      }`, { l: list }, { timeoutMs: 6_000 });
      return earliest([Number(d.claimed[0]?.claimedAt), Number(d.created[0]?.createdAt)]);
    },
  );
}

// ─── Sets of drops ───────────────────────────────────────────────────────────

/** Every drop ever made (from the mirror). Server only. */
export async function fetchAllDrops(opts: { fresh?: boolean } = {}): Promise<Drop[]> {
  serverOnly("fetchAllDrops");
  return mirrorDrops(opts);
}

/** Drops that can still be claimed right now (active and not expired). */
export function fetchLiveDrops(nowSec = Math.floor(Date.now() / 1000), opts: { fresh?: boolean } = {}): Promise<Drop[]> {
  serverOnly("fetchLiveDrops");
  return quick(
    (all) => all.filter((d) => d.status === 0 && d.expiry > nowSec),
    () => directWhere("status: 0, expiry_gt: $now", { now: String(nowSec) }),
    opts.fresh,
  );
}

/** Every drop these wallets created or claimed, newest first, de-duplicated. */
export async function fetchDropsForAddress(address: string | string[], opts: { fresh?: boolean } = {}): Promise<Drop[]> {
  serverOnly("fetchDropsForAddress");
  const list = [...new Set((Array.isArray(address) ? address : [address]).map((x) => x.toLowerCase()))];
  const set = new Set(list);
  const sortNewest = (ds: Drop[]) => {
    const byId = new Map<string, Drop>();
    for (const d of ds) byId.set(d.id.toString(), d);
    return [...byId.values()].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  };
  return quick(
    (all) => sortNewest(all.filter((d) => set.has(d.dropper.toLowerCase()) || set.has(d.claimer.toLowerCase()))),
    async () => {
      const parts = await Promise.all(list.flatMap((a) => [directWhere("dropper: $a", { a }), directWhere("claimer: $a", { a })]));
      return sortNewest(parts.flat());
    },
    opts.fresh,
  );
}

/** Every drop tagged for an event ([E:…] in its clue, possibly under [R]). */
export function fetchEventDrops(): Promise<Drop[]> {
  serverOnly("fetchEventDrops");
  return quick(
    (all) => all.filter((d) => d.hint.includes("[E:")),
    () => directWhere("hint_contains: $tag", { tag: "[E:" }),
  );
}
