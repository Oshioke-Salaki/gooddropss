// Real-world wiring for lib/welcome: Redis, the indexer snapshot, landmarks and
// the reward wallet. The rules live in lib/welcome (tested); this file only
// gathers facts and moves money.
//
// Money moves fail-closed:
//   • the person's record is set to "creating" BEFORE the drop is sent, and
//     rolled back if the send throws, so a crash can't hand out two chests;
//   • the reward wallet's lock (shared with referral and first-drop payouts) is
//     held for the send, so two transfers never race for the same nonce;
//   • a chest whose record was lost is still found and reclaimed by the sweep,
//     because it's tagged on-chain and dropped by the reward wallet.
//
// Server only.

import type { Redis } from "@upstash/redis";
import { createWalletClient, http, getAddress, erc20Abi, decodeEventLog, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { keys } from "@/lib/redis";
import { publicClient } from "@/lib/publicClient";
import { normalizePk } from "@/lib/pk";
import { G_TOKEN_ADDRESS, GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { isVerifiedHuman, resolveIdentityRootStrict } from "@/lib/identityRoot";
import { getBoardSnapshot, type BoardSnapshot } from "@/lib/boardSnapshot";
import { memo } from "@/lib/serverCache";
import { REWARD_WALLET } from "@/lib/refPayout";
import { buildWelcomeHint, parseDropHint } from "@/lib/utils";
import {
  welcomeConfig, decideWelcome, pickSpot, pickTier, nearBox, watDay, SPOT_MAX_M,
  type WelcomeConfig, type WelcomeRecord, type WelcomeDropRecord, type WelcomeView, type SpotCandidate,
} from "@/lib/welcome";

const WEI = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
/** Allowance set at a time, so approvals are rare but a leak is bounded. */
const ALLOWANCE_G = 50_000n;
const CHEST_CLUE = "Your welcome chest";

export async function loadWelcomeConfig(redis: Redis): Promise<WelcomeConfig> {
  try { return welcomeConfig(await redis.get<Partial<WelcomeConfig>>(keys.welcomeConfig())); }
  catch { return welcomeConfig(null); }
}

// ── Facts ────────────────────────────────────────────────────────────────────

/** Everyone (wallets and roots) who has ever claimed or hidden a drop, per snapshot. */
const activeCache = new WeakMap<BoardSnapshot, Set<string>>();
function activeSet(snap: BoardSnapshot): Set<string> {
  let s = activeCache.get(snap);
  if (s) return s;
  s = new Set<string>();
  const reward = REWARD_WALLET.toLowerCase();
  for (const d of snap.drops) {
    const by = d.dropper.toLowerCase();
    // Our own chests don't make their finder "already active" (the record covers them).
    if (by === reward) continue;
    s.add(by); s.add(snap.roots.get(by) ?? by);
    if (d.status === 1 && d.claimer !== ZERO) {
      const cl = d.claimer.toLowerCase();
      s.add(cl); s.add(snap.roots.get(cl) ?? cl);
    }
  }
  activeCache.set(snap, s);
  return s;
}

async function isActive(wallet: string, root: string): Promise<boolean> {
  const set = activeSet(await getBoardSnapshot());
  return set.has(wallet) || set.has(root);
}

interface LandmarkLite { lat: number; lng: number; name?: string; status?: string }

/** Approved landmarks, cached: they change a few times a week. */
function activeLandmarks(redis: Redis): Promise<LandmarkLite[]> {
  return memo("wc:landmarks", 10 * 60_000, async () => {
    const ids = ((await redis.smembers(keys.landmarksIndex())) ?? []).map(String);
    if (!ids.length) return [];
    const out: LandmarkLite[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const rows = await redis.mget<(LandmarkLite | null)[]>(...ids.slice(i, i + 200).map((id) => keys.landmark(id)));
      for (const r of rows) if (r && r.status === "active" && Number.isFinite(r.lat) && Number.isFinite(r.lng)) out.push(r);
    }
    return out;
  });
}

/** Known public places near the player: landmarks, then spots where a public drop was really claimed. */
async function spotCandidates(redis: Redis, lat: number, lng: number): Promise<SpotCandidate[]> {
  const box = nearBox(lat, lng, SPOT_MAX_M + 50);
  const inBox = (a: number, b: number) => a >= box.minLat && a <= box.maxLat && b >= box.minLng && b <= box.maxLng;
  const [lms, snap] = await Promise.all([activeLandmarks(redis).catch(() => []), getBoardSnapshot()]);
  const out: SpotCandidate[] = [];
  for (const l of lms) if (inBox(l.lat, l.lng)) out.push({ lat: l.lat, lng: l.lng, kind: "landmark", name: l.name });
  for (const d of snap.drops) {
    if (d.status !== 1) continue;
    const la = d.lat / 1e6, ln = d.lng / 1e6;
    if (!inBox(la, ln) || parseDropHint(d.hint).isPrivate) continue;
    out.push({ lat: la, lng: ln, kind: "claim" });
  }
  return out;
}

async function counts(redis: Redis, now: number): Promise<{ today: number; issuedG: number }> {
  const [t, g] = await redis.mget<(number | string | null)[]>(keys.welcomeDay(watDay(now)), keys.welcomeIssuedG());
  return { today: Number(t ?? 0) || 0, issuedG: Number(g ?? 0) || 0 };
}

// ── Keeping a live chest's record true to the chain ──────────────────────────

async function syncLive(redis: Redis, rec: WelcomeRecord, now: number): Promise<WelcomeRecord> {
  if (rec.status !== "live" || !rec.dropId) return rec;
  let d: { status: number; claimer: string; expiry: number };
  try {
    d = (await publicClient.readContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(rec.dropId)],
    })) as unknown as { status: number; claimer: string; expiry: number };
  } catch { return rec; } // chain unreachable: show what we last knew
  const status = Number(d.status);
  let next: WelcomeRecord | null = null;
  if (status === 1) next = { ...rec, status: "claimed" };
  else if (status === 2 || Number(d.expiry) <= now) next = { ...rec, status: "expired" };
  if (!next) return rec;
  await redis.set(keys.welcome(rec.root), next);
  if (next.status === "claimed") await redis.zrem(keys.welcomeLive(), rec.dropId).catch(() => {});
  return next;
}

// ── What a player sees ───────────────────────────────────────────────────────

/** GET: this wallet's chest. Reads only, except bringing a live chest's record up to date. */
export async function welcomeViewFor(redis: Redis, wallet: string): Promise<WelcomeView> {
  const w = wallet.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const root = (await resolveIdentityRootStrict(w)).toLowerCase();
  const cfg = await loadWelcomeConfig(redis);
  let rec = await redis.get<WelcomeRecord>(keys.welcome(root));
  if (rec) rec = await syncLive(redis, rec, now);
  return resolveView(redis, cfg, rec, w, root, now);
}

async function resolveView(redis: Redis, cfg: WelcomeConfig, rec: WelcomeRecord | null, w: string, root: string, now: number) {
  const facts: Parameters<typeof decideWelcome>[0] = { cfg, now, rec };
  for (let guard = 0; guard < 5; guard++) {
    const v = decideWelcome(facts);
    if (v === "need-active") facts.active = await isActive(w, root);
    else if (v === "need-verified") facts.verified = await isVerifiedHuman(w);
    else if (v === "need-counts") Object.assign(facts, await counts(redis, now));
    else return v;
  }
  return { state: "done" } as WelcomeView;
}

// ── Hiding a chest ───────────────────────────────────────────────────────────

export type ChestResult = { ok: true; view: WelcomeView } | { ok: false; status: number; error: string; view?: WelcomeView };

function rewardWallet() {
  const key = normalizePk(process.env.GAS_FAUCET_KEY);
  if (!key) return null;
  const account = privateKeyToAccount(key);
  if (getAddress(account.address) !== REWARD_WALLET) return null;
  return createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });
}

/** Wait briefly for the reward wallet's lock (a payout run may hold it). */
async function takeWalletLock(redis: Redis, token: string): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    if ((await redis.set(keys.refPayoutLock(), token, { nx: true, ex: 120 })) === "OK") return true;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  return false;
}
async function dropWalletLock(redis: Redis, token: string) {
  try { if ((await redis.get(keys.refPayoutLock())) === token) await redis.del(keys.refPayoutLock()); } catch { /* expires */ }
}

/**
 * POST: hide this person's chest near (lat, lng). The caller has checked the
 * wallet's signature. Returns the new view, or a friendly error that leaves
 * nothing half-done.
 */
export async function hideChest(redis: Redis, wallet: string, lat: number, lng: number): Promise<ChestResult> {
  const w = wallet.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  let root: string;
  try { root = (await resolveIdentityRootStrict(w)).toLowerCase(); }
  catch { return { ok: false, status: 503, error: "Couldn't check your account right now. Try again in a moment." }; }

  // One request per person at a time.
  const lock = await redis.set(keys.welcomeLock(root), "1", { nx: true, ex: 90 });
  if (lock !== "OK") return { ok: false, status: 409, error: "Your chest is already on its way." };

  try {
    const cfg = await loadWelcomeConfig(redis);
    let prev = await redis.get<WelcomeRecord>(keys.welcome(root));
    if (prev) prev = await syncLive(redis, prev, now);
    const view = await resolveView(redis, cfg, prev, w, root, now);
    if (view.state !== "ready") return { ok: true, view };

    // Daily cap: take a slot now, give it back if anything fails.
    const dayKey = keys.welcomeDay(watDay(now));
    const n = await redis.incr(dayKey);
    if (n === 1) await redis.expire(dayKey, 3 * 86_400);
    if (n > cfg.dailyCap) { await redis.decr(dayKey); return { ok: true, view: { state: "full" } }; }

    const attempt = view.attempt;
    const amountG = pickTier(cfg, root, attempt);
    const spot = pickSpot({ lat, lng }, await spotCandidates(redis, lat, lng), `${root}:${attempt}`);
    const expiry = now + cfg.expiryHours * 3600;

    const creating: WelcomeRecord = {
      root, wallet: w, status: "creating", tries: attempt, createdAt: now,
      lat: spot.lat, lng: spot.lng, kind: spot.kind, name: spot.name, amountG, expiry,
    };
    await redis.set(keys.welcome(root), creating);
    const rollback = async () => {
      if (prev) await redis.set(keys.welcome(root), prev); else await redis.del(keys.welcome(root));
      await redis.decr(dayKey);
    };

    const wallet$ = rewardWallet();
    if (!wallet$) { await rollback(); console.error("[welcome] reward key missing"); return { ok: false, status: 503, error: "Welcome chests are resting right now. Try again later." }; }

    const token = `wc:${root}:${now}`;
    if (!(await takeWalletLock(redis, token))) { await rollback(); return { ok: false, status: 503, error: "Busy right now. Try again in a minute." }; }

    let dropId: string;
    let tx: Hex;
    try {
      const wei = BigInt(amountG) * WEI;
      const [bal, allowance] = await Promise.all([
        publicClient.readContract({ address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET] }) as Promise<bigint>,
        publicClient.readContract({ address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [REWARD_WALLET, GOOD_DROPS_ADDRESS] }) as Promise<bigint>,
      ]);
      if (bal < wei) throw Object.assign(new Error("reward wallet short"), { friendly: "Welcome chests are resting right now. Try again later." });
      if (allowance < wei) {
        const a = await wallet$.writeContract({ address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "approve", args: [GOOD_DROPS_ADDRESS, ALLOWANCE_G * WEI] });
        await publicClient.waitForTransactionReceipt({ hash: a, timeout: 45_000 });
      }
      // Coordinates stay off-chain: (0,0) like every private drop.
      const args = [0, 0, wei, expiry, buildWelcomeHint(CHEST_CLUE)] as const;
      await publicClient.simulateContract({ account: wallet$.account, address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop", args });
      tx = await wallet$.writeContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop", args });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 45_000 });
      if (receipt.status !== "success") throw new Error("createDrop reverted");
      let found: string | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== GOOD_DROPS_ADDRESS.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: GOOD_DROPS_ABI, data: log.data, topics: log.topics });
          if (ev.eventName === "DropCreated") { found = (ev.args as { dropId: bigint }).dropId.toString(); break; }
        } catch { /* another event */ }
      }
      if (!found) throw new Error("no DropCreated in receipt");
      dropId = found;
    } catch (e) {
      // A sent-but-unconfirmed drop is still tagged on-chain; the sweep reclaims it.
      await dropWalletLock(redis, token);
      await rollback();
      console.error("[welcome] hide failed", (e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
      const friendly = (e as { friendly?: string }).friendly;
      return { ok: false, status: 503, error: friendly ?? "Couldn't hide your chest. Please try again." };
    }
    await dropWalletLock(redis, token);

    const live: WelcomeRecord = { ...creating, status: "live", dropId, tx };
    const gate: WelcomeDropRecord = { root, wallet: w, lat: spot.lat, lng: spot.lng, expiry };
    await Promise.all([
      redis.set(keys.welcomeDrop(dropId), gate, { ex: cfg.expiryHours * 3600 + 7 * 86_400 }),
      redis.set(keys.welcome(root), live),
      redis.zadd(keys.welcomeLive(), { score: expiry, member: dropId }),
      redis.incrby(keys.welcomeIssuedG(), amountG),
    ]);
    return { ok: true, view: { state: "live", dropId, lat: spot.lat, lng: spot.lng, kind: spot.kind, name: spot.name, expiry, amountG } };
  } finally {
    await redis.del(keys.welcomeLock(root)).catch(() => {});
  }
}

// ── Taking back chests that ran out ──────────────────────────────────────────

/** Reclaim expired, unclaimed chests to the reward wallet. Called from the referrals cron. */
export async function reclaimExpiredChests(redis: Redis): Promise<{ reclaimed: number; reason?: string }> {
  const now = Math.floor(Date.now() / 1000);
  const ids = (await redis.zrange<(string | number)[]>(keys.welcomeLive(), 0, now, { byScore: true })).map(String).slice(0, 20);
  if (!ids.length) return { reclaimed: 0 };
  const wallet$ = rewardWallet();
  if (!wallet$) return { reclaimed: 0, reason: "reward-key-missing" };

  const drops = await Promise.all(ids.map((id) => publicClient.readContract({
    address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(id)],
  }).then((d) => d as unknown as { status: number; amount: bigint; expiry: number; dropper: string }).catch(() => null)));

  const toReclaim: bigint[] = [];
  let backG = 0;
  for (let i = 0; i < ids.length; i++) {
    const d = drops[i];
    if (!d) continue; // unreadable: try next run
    if (Number(d.status) !== 0) { await redis.zrem(keys.welcomeLive(), ids[i]); continue; } // claimed or already back
    // Block time can trail ours; the contract reverts the whole batch on one early id.
    if (d.dropper.toLowerCase() !== REWARD_WALLET.toLowerCase() || Number(d.expiry) > now - 60) continue;
    toReclaim.push(BigInt(ids[i]));
    backG += Number(d.amount / WEI);
  }
  if (!toReclaim.length) return { reclaimed: 0 };

  const token = `wc:reclaim:${now}`;
  if (!(await takeWalletLock(redis, token))) return { reclaimed: 0, reason: "busy" };
  try {
    const tx = await wallet$.writeContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "reclaimManyExpired", args: [toReclaim] });
    const r = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 45_000 });
    if (r.status !== "success") return { reclaimed: 0, reason: "reverted" };
    await redis.zrem(keys.welcomeLive(), ...toReclaim.map(String) as [string, ...string[]]);
    await redis.incrby(keys.welcomeIssuedG(), -backG);
    return { reclaimed: toReclaim.length };
  } catch (e) {
    console.error("[welcome] reclaim failed", (e as Error).message);
    return { reclaimed: 0, reason: "failed" };
  } finally {
    await dropWalletLock(redis, token);
  }
}
