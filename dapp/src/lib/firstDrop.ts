// First-drop bonus: a verified person's first drop earns them 200 G$ from the
// reward wallet. The nudge after their daily claim points them at it.
//
// Rules (one place, tested in firstDrop.test.ts):
//   • verified GoodDollar humans only, one bonus per PERSON (identity root),
//     however many wallets they use;
//   • only for someone whose first ever drop is on or after FIRST_DROP_SINCE:
//     people who dropped before the bonus existed already took the step;
//   • paid to the wallet that made the drop.
//
// Money moves fail-closed, the same way refPayout does: the record is marked
// "sending" BEFORE the transfer and rolled back to "owed" if the broadcast
// throws. A process killed mid-send leaves "sending" with no tx: an under-pay
// to settle by hand, never a double-pay. Sends share refPayout's lock, so two
// transfers from the reward wallet never race for the same nonce.
//
// Server only.

import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";

export const FIRST_DROP_BONUS_G = 200;
export const FIRST_DROP_BONUS_WEI = BigInt(FIRST_DROP_BONUS_G) * 10n ** 18n;
/** 24 Nov 2026 00:00 UTC, when the bonus started. */
export const FIRST_DROP_SINCE = 1_795_478_400;

/**
 * What a wallet sees:
 *   offer       verified, never dropped: the bonus is there for the taking
 *   owed        first drop made, 200 G$ queued (wallet short or a send pending)
 *   sending     transfer in flight
 *   paid        sent (tx set)
 *   done        dropped before the bonus existed, or the bonus went to another
 *               of their wallets: nothing to offer
 *   unverified  not a verified human yet
 */
export type FirstDropStatus = "offer" | "owed" | "sending" | "paid" | "done" | "unverified";

export interface FirstDropRecord {
  root: string;
  /** The wallet that made the drop: the bonus goes here. */
  wallet: string;
  dropId: string;
  /** Unix seconds registered. */
  at: number;
  status: "owed" | "sending" | "paid";
  tx?: string;
  paidAt?: number;
}

export interface FirstDropView {
  status: FirstDropStatus;
  bonusG: number;
  /** Which wallet got (or gets) it, when it's one of theirs. */
  wallet?: string;
  tx?: string;
}

export interface DropLite { id: string; dropper: string; createdAt: number }

export interface FirstDropDeps {
  isVerified(address: string): Promise<boolean>;
  /** Strict: throws when the chain can't be read (never key a bonus to the wrong person). */
  resolveRoot(address: string): Promise<string>;
  /** Every drop this person made, across the wallets we can link to them. */
  dropsOf(wallet: string, root: string): Promise<DropLite[]>;
  /** A just-made drop the indexer may not have yet, read from the chain. */
  readDrop?(dropId: string): Promise<{ dropper: string } | null>;
  now?(): number;
}

export type FirstDropDecision =
  | { kind: "unverified" }
  | { kind: "offer" }
  | { kind: "done" }
  | { kind: "earn"; drop: DropLite };

/** Pure: given the facts, what does this person get? */
export function decideFirstDrop(f: { verified: boolean; drops: DropLite[]; since?: number }): FirstDropDecision {
  if (!f.verified) return { kind: "unverified" };
  if (!f.drops.length) return { kind: "offer" };
  const first = [...f.drops].sort((a, b) => a.createdAt - b.createdAt || Number(BigInt(a.id) - BigInt(b.id)))[0];
  if (first.createdAt < (f.since ?? FIRST_DROP_SINCE)) return { kind: "done" };
  return { kind: "earn", drop: first };
}

function view(rec: FirstDropRecord, wallet: string): FirstDropView {
  const mine = rec.wallet.toLowerCase() === wallet.toLowerCase();
  return { status: rec.status, bonusG: FIRST_DROP_BONUS_G, wallet: rec.wallet, ...(mine && rec.tx ? { tx: rec.tx } : {}) };
}

const ADDR = /^0x[0-9a-f]{40}$/;

/**
 * Where this wallet stands, registering the bonus the moment their first drop
 * is seen. Safe to call as often as we like: registration is SET NX per person,
 * so the GET on page load doubles as a self-heal when the post-drop call was
 * missed (tab closed, offline).
 *
 * `dropId`: a drop the caller just made, so a fresh drop counts before the
 * indexer has caught up. Ignored unless the chain says this wallet made it.
 */
export async function firstDropState(redis: Redis, wallet: string, deps: FirstDropDeps, dropId?: string): Promise<FirstDropView> {
  const w = wallet.toLowerCase();
  if (!ADDR.test(w)) return { status: "unverified", bonusG: FIRST_DROP_BONUS_G };
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);

  if (!(await deps.isVerified(w))) return { status: "unverified", bonusG: FIRST_DROP_BONUS_G };
  const root = (await deps.resolveRoot(w)).toLowerCase();

  const existing = await redis.get<FirstDropRecord>(keys.firstDrop(root));
  if (existing) return view(existing, w);

  const drops = [...(await deps.dropsOf(w, root))];
  if (dropId && /^\d+$/.test(dropId) && !drops.some((d) => d.id === dropId) && deps.readDrop) {
    const onChain = await deps.readDrop(dropId).catch(() => null);
    if (onChain && onChain.dropper.toLowerCase() === w) drops.push({ id: dropId, dropper: w, createdAt: now });
  }

  const d = decideFirstDrop({ verified: true, drops });
  if (d.kind === "offer") return { status: "offer", bonusG: FIRST_DROP_BONUS_G };
  if (d.kind !== "earn") return { status: "done", bonusG: FIRST_DROP_BONUS_G };

  // The bonus goes to whoever made the drop. Reached from another wallet of
  // theirs, it still registers (to the dropping wallet), and reads as theirs.
  const rec: FirstDropRecord = { root, wallet: d.drop.dropper.toLowerCase(), dropId: d.drop.id, at: now, status: "owed" };
  const won = await redis.set(keys.firstDrop(root), JSON.stringify(rec), { nx: true });
  if (won !== "OK") {
    const raced = await redis.get<FirstDropRecord>(keys.firstDrop(root));
    return raced ? view(raced, w) : { status: "done", bonusG: FIRST_DROP_BONUS_G };
  }
  await redis.zadd(keys.firstDropOwed(), { nx: true }, { score: now, member: root });
  return view(rec, w);
}

// ── Paying ───────────────────────────────────────────────────────────────────

export interface BonusSender {
  balance(): Promise<bigint>;
  /** Broadcasts the transfer; resolves with its hash. Throws if nothing was sent. */
  transfer(to: string, wei: bigint): Promise<string>;
}

export interface FirstDropPayoutResult {
  ok: boolean;
  reason?: string;
  paid: { root: string; to: string; tx: string }[];
  waiting: number;
  errors: { root: string; error: string }[];
}

/** Most bonuses one run sends; the rest wait for the next. */
const BATCH = 25;

/** Pay every queued bonus the wallet can cover, oldest first. */
export async function runFirstDropPayout(redis: Redis, sender: BonusSender, lockKey: string): Promise<FirstDropPayoutResult> {
  const out: FirstDropPayoutResult = { ok: false, paid: [], waiting: 0, errors: [] };
  const queued = await redis.zrange<string[]>(keys.firstDropOwed(), 0, BATCH - 1);
  if (!queued.length) return { ...out, ok: true };

  const locked = await redis.set(lockKey, Date.now(), { nx: true, ex: 300 });
  if (locked !== "OK") return { ...out, reason: "another-run-in-progress", waiting: queued.length };

  try {
    let bal = await sender.balance();
    for (const root of queued) {
      const rec = await redis.get<FirstDropRecord>(keys.firstDrop(root));
      if (!rec || rec.status !== "owed") { await redis.zrem(keys.firstDropOwed(), root); continue; }
      if (bal < FIRST_DROP_BONUS_WEI) { out.reason = "wallet-short"; out.waiting++; continue; }

      // Mark first (see header).
      await redis.set(keys.firstDrop(root), JSON.stringify({ ...rec, status: "sending" }));
      await redis.zrem(keys.firstDropOwed(), root);
      await redis.incrby(keys.firstDropPaidG(), FIRST_DROP_BONUS_G);

      let tx: string;
      try {
        tx = await sender.transfer(rec.wallet, FIRST_DROP_BONUS_WEI);
      } catch (e) {
        // Nothing left the wallet: put it back exactly as it was.
        await redis.set(keys.firstDrop(root), JSON.stringify(rec));
        await redis.zadd(keys.firstDropOwed(), { score: rec.at, member: root });
        await redis.incrby(keys.firstDropPaidG(), -FIRST_DROP_BONUS_G);
        out.errors.push({ root, error: (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message });
        out.waiting++;
        continue;
      }
      bal -= FIRST_DROP_BONUS_WEI;
      const nowS = Math.floor(Date.now() / 1000);
      await redis.set(keys.firstDrop(root), JSON.stringify({ ...rec, status: "paid", tx, paidAt: nowS }));
      out.paid.push({ root, to: rec.wallet, tx });
    }
    return { ...out, ok: true };
  } finally {
    await redis.del(lockKey);
  }
}
