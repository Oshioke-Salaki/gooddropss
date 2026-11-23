// Server only. The referral ledger: how an invite becomes a counted referral.
//
// The flow, and why it's built this way:
//
//   1. OFFER  The invitee's wallet signs "I accept <referrer>'s invite" as soon as
//             they're signed in. The server saves that as a PENDING invite. It's
//             saved before they qualify on purpose: the old flow only tried at the
//             moment of their first claim, in that one browser tab, so anyone who
//             claimed and closed the app (or whose claim the indexer hadn't seen
//             yet) was never counted.
//   2. SETTLE A pending invite is re-checked whenever there's a reason to (their
//             app sees a claim, a visit, the sweep cron every few minutes) and is
//             counted the moment every rule holds. Nothing depends on the invitee
//             keeping the app open.
//   3. CREDIT Written once, first referrer wins (SET NX on the invitee's identity),
//             under the referrer's ACCOUNT, which is bound the first time and
//             never moves (see keys.refAccount).
//
// Rules for a referral to count (unchanged from before, now applied at settle):
//   • the invitee is a verified GoodDollar human (Sybil resistance);
//   • they've claimed or created a drop (an active player, not a bare sign-up);
//   • they're NEW: they hadn't been playing for more than NEW_MEMBER_WINDOW_S
//     before they accepted the invite (measured from the OFFER, so someone who
//     signs up today and claims next week still counts);
//   • they aren't the referrer (any wallet or identity of theirs);
//   • nobody else has been credited for them.
//
// Every outcome is one of InviteResult. "waiting" is never an error: it's an
// invite that will count later. "rejected" is final and the pending row is gone.

import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { REF_ADDR_RE, type InviteResult } from "@/lib/referral";

/** Invites accepted this long ago without qualifying are dropped. */
export const PENDING_TTL_S = 30 * 24 * 60 * 60;
/** Stored a week longer than it's valid, so the sweep can still read and clean it up. */
const PENDING_STORE_S = PENDING_TTL_S + 7 * 24 * 60 * 60;
/** "New to GoodDrops": first claim or drop no earlier than this before accepting. */
export const NEW_MEMBER_WINDOW_S = 3 * 24 * 60 * 60;

export interface PendingInvite {
  /** The referrer's wallet, as it appeared in their link. */
  referrer: string;
  /** Unix seconds the invitee accepted (signed) the invite. */
  at: number;
  /** The referrer account it's listed under as "on the way" (so it can be removed). */
  shownTo?: string;
}

/** Everything settle needs from the outside world. Injected so it can be tested. */
export interface LedgerDeps {
  /** Wallet → GoodDollar identity root. Must THROW when it can't tell. */
  resolveRoot(address: string): Promise<string>;
  /** Is this wallet a verified GoodDollar human? false when unsure. */
  isVerified(address: string): Promise<boolean>;
  /** Has this wallet claimed or created a drop? Throws when it can't tell. */
  hasActivity(address: string): Promise<boolean>;
  /** Earliest claim/drop across these wallets (unix s), null if none. Throws when it can't tell. */
  firstActivityAt(addresses: string[]): Promise<number | null>;
  /** Called after a NEW referral is written (enrol in competitions, pay out). Never throws. */
  onCredited?(c: { account: string; inviteeRoot: string; referrerWallet: string; at: number }): Promise<void>;
  now?(): number; // unix seconds
}

const lc = (a: string) => a.toLowerCase();
const nowS = (deps: LedgerDeps) => (deps.now ? deps.now() : Math.floor(Date.now() / 1000));

// ── The referrer's account ────────────────────────────────────────────────────

/**
 * The key a referrer's referrals live under. Their bound account if they have one
 * (by wallet, then by identity root), else their identity root today. Throws only
 * if the root can't be read AND nothing is bound.
 */
export async function referralAccountFor(redis: Redis, wallet: string, deps: Pick<LedgerDeps, "resolveRoot">): Promise<string> {
  const w = lc(wallet);
  const direct = await redis.get<string>(keys.refAccount(w));
  if (direct && REF_ADDR_RE.test(direct)) return lc(direct);
  const root = lc(await deps.resolveRoot(w));
  if (root !== w) {
    const viaRoot = await redis.get<string>(keys.refAccount(root));
    if (viaRoot && REF_ADDR_RE.test(viaRoot)) return lc(viaRoot);
  }
  return root;
}

/** Read-only flavour for display: never throws, falls back to the wallet. */
export async function referralAccountForDisplay(redis: Redis, wallet: string, deps: Pick<LedgerDeps, "resolveRoot">): Promise<string> {
  try { return await referralAccountFor(redis, wallet, deps); }
  catch { return lc(wallet); }
}

// ── Offer ─────────────────────────────────────────────────────────────────────

/**
 * Save a signed invite for this invitee wallet. First touch wins: if one is
 * already waiting, it stays (and is returned). Caller has verified the signature.
 */
export async function offerInvite(
  redis: Redis, invitee: string, referrer: string, deps: Pick<LedgerDeps, "resolveRoot" | "now">,
): Promise<PendingInvite> {
  const inv = lc(invitee), ref = lc(referrer);
  const at = nowS(deps as LedgerDeps);
  // Where the referrer will see it as "on the way". If their root can't be read
  // right now it's listed under the wallet; it's still settled to the right account.
  const shownTo = await referralAccountForDisplay(redis, ref, deps);
  const fresh: PendingInvite = { referrer: ref, at, shownTo };
  const ok = await redis.set(keys.refPending(inv), JSON.stringify(fresh), { nx: true, ex: PENDING_STORE_S });
  if (ok !== "OK") {
    const existing = await readPending(redis, inv);
    if (existing) return existing;
    // It vanished between the two calls: take the slot now.
    await redis.set(keys.refPending(inv), JSON.stringify(fresh), { ex: PENDING_STORE_S });
  }
  await redis.zadd(keys.refPendingAll(), { score: at, member: inv });
  await redis.zadd(keys.refPendingOf(shownTo), { score: at, member: inv });
  return fresh;
}

export async function readPending(redis: Redis, invitee: string): Promise<PendingInvite | null> {
  const raw = await redis.get<string | PendingInvite>(keys.refPending(lc(invitee)));
  if (!raw) return null;
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  const p = v as Partial<PendingInvite>;
  if (!p || typeof p.referrer !== "string" || !REF_ADDR_RE.test(p.referrer) || typeof p.at !== "number" || !Number.isFinite(p.at)) return null;
  const shownTo = typeof p.shownTo === "string" && REF_ADDR_RE.test(p.shownTo) ? lc(p.shownTo) : undefined;
  return { referrer: lc(p.referrer), at: p.at, ...(shownTo ? { shownTo } : {}) };
}

async function dropPending(redis: Redis, invitee: string, pending: PendingInvite, account: string | null): Promise<void> {
  const inv = lc(invitee);
  await redis.del(keys.refPending(inv));
  await redis.zrem(keys.refPendingAll(), inv);
  const lists = new Set([pending.shownTo, account, pending.referrer].filter((x): x is string => !!x));
  for (const l of lists) await redis.zrem(keys.refPendingOf(l), inv);
}

// ── The decision (pure) ───────────────────────────────────────────────────────

export interface InviteFacts {
  now: number;
  pending: PendingInvite;
  inviteeWallet: string;
  inviteeRoot: string;
  referrerRoot: string;
  /** The account the referral would be credited to. */
  account: string;
  /** The account the INVITEE earns under, if they've ever referred anyone. */
  inviteeAccount: string | null;
  /** Who this invitee's identity is already credited to, if anyone. */
  existingReferrer: string | null;
  verified: boolean;
  /** undefined = not checked yet (only needed once verified). */
  active?: boolean;
  firstActivityAt?: number | null;
}

/** What to do with a pending invite, given the facts. No I/O. */
export function decideInvite(f: InviteFacts): InviteResult & { credit?: true } {
  const referrer = f.account;
  if (f.now - f.pending.at > PENDING_TTL_S) return { status: "rejected", reason: "expired", referrer };

  const selfKeys = new Set([lc(f.pending.referrer), f.referrerRoot, f.account]);
  if (selfKeys.has(f.inviteeWallet) || selfKeys.has(f.inviteeRoot) || (f.inviteeAccount && selfKeys.has(f.inviteeAccount))) {
    return { status: "rejected", reason: "self", referrer };
  }

  if (f.existingReferrer) {
    return f.existingReferrer === f.account
      ? { status: "already", referrer }
      : { status: "rejected", reason: "taken", referrer: f.existingReferrer };
  }

  if (!f.verified) return { status: "waiting", reason: "verify", referrer };
  if (f.active === undefined) return { status: "waiting", reason: "retry", referrer };
  if (!f.active) return { status: "waiting", reason: "task", referrer };

  if (f.firstActivityAt === undefined) return { status: "waiting", reason: "retry", referrer };
  if (f.firstActivityAt !== null && f.firstActivityAt < f.pending.at - NEW_MEMBER_WINDOW_S) {
    return { status: "rejected", reason: "notNew", referrer };
  }
  return { status: "credited", referrer, credit: true };
}

// ── Settle ────────────────────────────────────────────────────────────────────

/**
 * Re-check this invitee's pending invite and count it if it qualifies.
 * Idempotent and safe to call as often as anyone likes; concurrent calls for the
 * same invitee are serialised by a short lock, and the credit itself is SET NX.
 * Never throws: anything it can't check right now comes back as waiting/retry.
 */
export async function settleInvite(
  redis: Redis, invitee: string, deps: LedgerDeps, opts: { lockMs?: number } = {},
): Promise<InviteResult> {
  const inv = lc(invitee);
  if (!REF_ADDR_RE.test(inv)) return { status: "none" };

  const lock = keys.refSettleLock(inv);
  const got = await redis.set(lock, "1", { nx: true, px: opts.lockMs ?? 8_000 });
  if (got !== "OK") {
    const p = await readPending(redis, inv);
    return p ? { status: "waiting", reason: "retry", referrer: p.referrer } : { status: "none" };
  }
  try {
    return await settleLocked(redis, inv, deps);
  } catch (e) {
    console.error("[referral/settle]", inv, e);
    const p = await readPending(redis, inv).catch(() => null);
    return p ? { status: "waiting", reason: "retry", referrer: p.referrer } : { status: "none" };
  } finally {
    await redis.del(lock).catch(() => {});
  }
}

async function settleLocked(redis: Redis, inv: string, deps: LedgerDeps): Promise<InviteResult> {
  const pending = await readPending(redis, inv);
  const now = nowS(deps);

  // Identity first: everything below is keyed by it. Unknown → try again later.
  let inviteeRoot: string, referrerRoot: string;
  try {
    inviteeRoot = lc(await deps.resolveRoot(inv));
    referrerRoot = pending ? lc(await deps.resolveRoot(pending.referrer)) : "";
  } catch {
    return pending ? { status: "waiting", reason: "retry", referrer: pending.referrer } : { status: "none" };
  }

  if (!pending) {
    const by = await redis.get<string>(keys.referredBy(inviteeRoot));
    return by ? { status: "already", referrer: lc(by) } : { status: "none" };
  }

  const account = await referralAccountFor(redis, pending.referrer, deps);
  const [existingRaw, inviteeAcctRaw] = await Promise.all([
    redis.get<string>(keys.referredBy(inviteeRoot)),
    redis.get<string>(keys.refAccount(inv)),
  ]);
  const facts: InviteFacts = {
    now, pending, inviteeWallet: inv, inviteeRoot, referrerRoot, account,
    inviteeAccount: inviteeAcctRaw ? lc(inviteeAcctRaw) : null,
    existingReferrer: existingRaw ? lc(existingRaw) : null,
    verified: false,
  };

  // Cheap, final answers come first (expired / self / already taken)…
  let d = decideInvite(facts);
  if (d.status === "waiting" && d.reason === "verify") {
    // …then the checks that cost a request, each only once the last one passed.
    facts.verified = await deps.isVerified(inv);
    if (facts.verified) {
      try { facts.active = await deps.hasActivity(inv); } catch { /* stays undefined → retry */ }
      if (facts.active) {
        try { facts.firstActivityAt = await deps.firstActivityAt([inv, inviteeRoot]); } catch { /* retry */ }
      }
    }
    d = decideInvite(facts);
  }

  if (d.status === "waiting") return { status: d.status, reason: d.reason, referrer: pending.referrer };
  if (d.status !== "credited") {
    await dropPending(redis, inv, pending, account);
    return { status: d.status, reason: d.reason, referrer: d.referrer };
  }

  const written = await creditReferral(redis, {
    inviteeRoot, account, referrerWallet: pending.referrer, referrerRoot, at: now,
  }, deps);
  await dropPending(redis, inv, pending, account);
  return written;
}

/**
 * Write a referral. The invitee's identity is claimed with SET NX, so two racing
 * credits can't both win; everything after it is idempotent. Also used by the
 * admin "credit a missed referral" tool, with its own timestamp.
 */
export async function creditReferral(
  redis: Redis,
  c: {
    inviteeRoot: string; account: string; referrerWallet: string; referrerRoot: string; at: number;
    /** "keep": only set the prize wallet if there's none (admin entries may be a root, not the wallet in use). */
    payoutWallet?: "replace" | "keep";
  },
  deps: Pick<LedgerDeps, "onCredited">,
): Promise<InviteResult> {
  const inviteeRoot = lc(c.inviteeRoot), account = lc(c.account);
  const claimed = await redis.set(keys.referredBy(inviteeRoot), account, { nx: true });
  if (claimed !== "OK") {
    const by = lc((await redis.get<string>(keys.referredBy(inviteeRoot))) ?? "");
    if (by && by !== account) return { status: "rejected", reason: "taken", referrer: by };
    // Same referrer: fall through and make sure the rest of the record is there.
  }

  // Bind the account for good, by wallet and by today's root, so it can't drift.
  await redis.set(keys.refAccount(lc(c.referrerWallet)), account, { nx: true });
  if (c.referrerRoot && REF_ADDR_RE.test(c.referrerRoot)) {
    await redis.set(keys.refAccount(lc(c.referrerRoot)), account, { nx: true });
  }

  const added = await redis.sadd(keys.referralsOf(account), inviteeRoot);
  await redis.zadd(keys.referralCredited(account), { nx: true }, { score: c.at, member: inviteeRoot });
  // The wallet their link came from is where prizes are paid.
  if (c.payoutWallet === "keep") await redis.set(keys.compPayoutWallet(account), lc(c.referrerWallet), { nx: true });
  else await redis.set(keys.compPayoutWallet(account), lc(c.referrerWallet));
  if (added) {
    await redis.zincrby(keys.referralLeaders(), 1, account);
    if (deps.onCredited) {
      try { await deps.onCredited({ account, inviteeRoot, referrerWallet: lc(c.referrerWallet), at: c.at }); }
      catch (e) { console.error("[referral/onCredited]", e); }
    }
    return { status: "credited", referrer: account };
  }
  return { status: claimed === "OK" ? "credited" : "already", referrer: account };
}

// ── Referrer-side numbers ─────────────────────────────────────────────────────

export interface ReferrerStats { account: string; count: number; waiting: number }

/** How many people a referrer has brought in, and how many are on the way. */
export async function referrerStats(redis: Redis, wallet: string, deps: Pick<LedgerDeps, "resolveRoot" | "now">): Promise<ReferrerStats> {
  const account = await referralAccountForDisplay(redis, wallet, deps);
  const since = nowS(deps as LedgerDeps) - PENDING_TTL_S;
  const [count, waiting] = await Promise.all([
    redis.scard(keys.referralsOf(account)),
    redis.zcount(keys.refPendingOf(account), since, "+inf"),
  ]);
  return { account, count: count ?? 0, waiting: waiting ?? 0 };
}
