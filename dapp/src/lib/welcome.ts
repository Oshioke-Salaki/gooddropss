// Welcome chest: the first win for a new player, wherever they are.
//
// A new player who opens an empty map has nothing to do, and leaves. So the
// moment they're verified, the reward wallet hides a small private drop (a
// "chest") a short walk from them. Only they can claim it. They hunt it with the
// hot-and-cold radar, open it, and are then asked to pass it on by hiding a drop
// of their own (which the first-drop bonus pays them back for).
//
// Rules (one place, tested in welcome.test.ts):
//   • verified GoodDollar humans only, one chest per PERSON (identity root);
//   • only for people who have never claimed or hidden a drop;
//   • a chest that runs out unclaimed may be re-hidden, up to maxTries in all;
//   • a daily cap and an all-time G$ budget, both admin-editable, and an off switch;
//   • the spot is a known public place (an approved landmark, or somewhere a
//     drop was really claimed before) 120 to 450 m away. With none nearby, the
//     chest goes right where they stand: never a random point that could be
//     someone's compound or a river.
//
// Pure: no I/O. The route and lib/welcomeServer supply the world.

export interface WelcomeTier {
  /** Whole G$ in the chest. */
  g: number;
  /** Chance out of 1,000. Tiers should add up to 1,000. */
  per1000: number;
}

export interface WelcomeConfig {
  enabled: boolean;
  /** Most chests hidden per WAT day, across everyone. */
  dailyCap: number;
  /** Most G$ ever hidden in chests (net of chests taken back). */
  budgetG: number;
  /** How long a chest stays claimable. */
  expiryHours: number;
  /** Chests one person can be given in all (a re-hide after one runs out). */
  maxTries: number;
  tiers: WelcomeTier[];
}

export const WELCOME_DEFAULTS: WelcomeConfig = {
  enabled: true,
  dailyCap: 200,
  budgetG: 1_000_000,
  expiryHours: 24,
  maxTries: 2,
  // Average 255 G$: most get 150, some 400, a lucky few 1,500.
  tiers: [
    { g: 150, per1000: 800 },
    { g: 400, per1000: 150 },
    { g: 1_500, per1000: 50 },
  ],
};

/** Merge stored overrides onto the defaults, dropping anything malformed. */
export function welcomeConfig(stored: Partial<WelcomeConfig> | null | undefined): WelcomeConfig {
  const c = { ...WELCOME_DEFAULTS };
  if (!stored || typeof stored !== "object") return c;
  if (typeof stored.enabled === "boolean") c.enabled = stored.enabled;
  const posInt = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  c.dailyCap = posInt(stored.dailyCap, 100_000) ?? c.dailyCap;
  c.budgetG = posInt(stored.budgetG, 1_000_000_000) ?? c.budgetG;
  c.expiryHours = posInt(stored.expiryHours, 24 * 30) || c.expiryHours;
  c.maxTries = posInt(stored.maxTries, 10) || c.maxTries;
  if (Array.isArray(stored.tiers)) {
    const tiers = stored.tiers.filter((t): t is WelcomeTier =>
      !!t && posInt(t.g, 10_000) !== null && t.g >= 1 && posInt(t.per1000, 1000) !== null);
    if (tiers.length && tiers.reduce((s, t) => s + t.per1000, 0) === 1000) c.tiers = tiers;
  }
  return c;
}

// ── Seeded randomness ────────────────────────────────────────────────────────
// Deterministic per person and attempt: a retried request can't re-roll for a
// bigger chest, and tests can pin outcomes.

/** FNV-1a, 32-bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The chest's size for this person's nth chest (1-based). */
export function pickTier(cfg: WelcomeConfig, root: string, attempt: number): number {
  const roll = hash32(`gd-wc-tier:${root.toLowerCase()}:${attempt}`) % 1000;
  let acc = 0;
  for (const t of cfg.tiers) {
    acc += t.per1000;
    if (roll < acc) return t.g;
  }
  return cfg.tiers[0]?.g ?? WELCOME_DEFAULTS.tiers[0].g;
}

// ── Where the chest goes ─────────────────────────────────────────────────────

export const SPOT_MIN_M = 120;
export const SPOT_MAX_M = 450;
/** The walk we aim for: long enough to be a hunt, short enough to finish. */
const SPOT_IDEAL_M = 260;

export type SpotKind = "landmark" | "claim" | "here";

export interface SpotCandidate { lat: number; lng: number; kind: Exclude<SpotKind, "here">; name?: string }
export interface WelcomeSpot { lat: number; lng: number; kind: SpotKind; name?: string; distanceM: number }

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Cheap pre-filter before the exact distance: a box around the player. */
export function nearBox(lat: number, lng: number, m: number) {
  const dLat = m / 111_320;
  const dLng = m / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/**
 * Pick the chest's spot from known public places. Landmarks win over past claim
 * spots (named, and someone vetted them); among the best few, the person's seed
 * chooses, so two players at the same bus stop don't get the same corner.
 */
export function pickSpot(user: { lat: number; lng: number }, candidates: SpotCandidate[], seed: string): WelcomeSpot {
  const seen = new Set<string>();
  const scored: (WelcomeSpot & { score: number })[] = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || (c.lat === 0 && c.lng === 0)) continue;
    const d = distanceM(user.lat, user.lng, c.lat, c.lng);
    if (d < SPOT_MIN_M || d > SPOT_MAX_M) continue;
    // Many claims happen at the same corner; keep one per ~25 m cell.
    const cell = `${Math.round(c.lat * 4000)}:${Math.round(c.lng * 4000)}`;
    if (seen.has(cell)) continue;
    seen.add(cell);
    const score = Math.abs(d - SPOT_IDEAL_M);
    scored.push({ lat: c.lat, lng: c.lng, kind: c.kind, name: c.name, distanceM: Math.round(d), score });
  }
  if (scored.length === 0) return { lat: user.lat, lng: user.lng, kind: "here", distanceM: 0 };
  scored.sort((a, b) => a.score - b.score || a.lat - b.lat || a.lng - b.lng);
  // A landmark in range always beats a past claim spot.
  const landmarks = scored.filter((x) => x.kind === "landmark");
  const pool = (landmarks.length ? landmarks : scored).slice(0, 5);
  const p = pool[hash32(`gd-wc-spot:${seed}`) % pool.length];
  return { lat: p.lat, lng: p.lng, kind: p.kind, name: p.name, distanceM: p.distanceM };
}

// ── Records and what a player sees ───────────────────────────────────────────

export type WelcomeStatus = "creating" | "live" | "claimed" | "expired";

export interface WelcomeRecord {
  root: string;
  /** The wallet that asked; the chest can be claimed from it or any wallet of the same person. */
  wallet: string;
  status: WelcomeStatus;
  /** Chests given so far, including this one. */
  tries: number;
  dropId?: string;
  lat?: number;
  lng?: number;
  kind?: SpotKind;
  name?: string;
  amountG?: number;
  /** Unix seconds. */
  createdAt: number;
  expiry?: number;
  tx?: string;
}

/** Stored per chest: what the claim gate checks. */
export interface WelcomeDropRecord { root: string; wallet: string; lat: number; lng: number; expiry: number }

/** A "creating" record older than this died mid-request: it no longer blocks a retry. */
export const CREATING_STALE_S = 180;

export type WelcomeView =
  | { state: "off" }
  | { state: "signed-out" }
  | { state: "verify" }
  | { state: "ready"; attempt: number }
  | { state: "full" }
  | { state: "creating" }
  | { state: "live"; dropId: string; lat: number; lng: number; kind: SpotKind; name?: string; expiry: number; amountG: number }
  | { state: "claimed"; amountG: number; dropId: string }
  | { state: "done" };

export interface WelcomeFacts {
  cfg: WelcomeConfig;
  now: number;
  rec: WelcomeRecord | null;
  /** Has this person ever claimed or hidden a drop (any wallet of theirs)? Undefined = not checked. */
  active?: boolean;
  /** Verified right now. Undefined = not checked. */
  verified?: boolean;
  /** Chests hidden today, and the budget used so far. */
  today?: number;
  issuedG?: number;
}

/**
 * What this person sees. Cheap answers come first, so the route only pays for a
 * chain read when it has to: a record decides almost everyone, then activity
 * (from the cached snapshot), and only then verification.
 */
export function decideWelcome(f: WelcomeFacts): WelcomeView | "need-active" | "need-verified" | "need-counts" {
  const { cfg, rec, now } = f;

  if (rec) {
    if (rec.status === "claimed") return { state: "claimed", amountG: rec.amountG ?? 0, dropId: rec.dropId ?? "" };
    if (rec.status === "live" && rec.dropId && rec.expiry && rec.expiry > now && rec.lat !== undefined && rec.lng !== undefined) {
      return { state: "live", dropId: rec.dropId, lat: rec.lat, lng: rec.lng, kind: rec.kind ?? "here", name: rec.name, expiry: rec.expiry, amountG: rec.amountG ?? 0 };
    }
    if (rec.status === "creating" && now - rec.createdAt < CREATING_STALE_S) return { state: "creating" };
    // Ran out unclaimed (or a request died): allowed again only while tries remain.
    const used = rec.status === "creating" ? rec.tries - 1 : rec.tries;
    if (used >= cfg.maxTries) return { state: "done" };
  }

  if (!cfg.enabled) return { state: "off" };
  // Someone who already played doesn't need a welcome. A record means they were
  // new when it was made, so a chest of ours doesn't count against them here.
  if (!rec) {
    if (f.active === undefined) return "need-active";
    if (f.active) return { state: "done" };
  }
  if (f.verified === undefined) return "need-verified";
  if (!f.verified) return { state: "verify" };
  if (f.today === undefined || f.issuedG === undefined) return "need-counts";
  const attempt = (rec ? (rec.status === "creating" ? rec.tries - 1 : rec.tries) : 0) + 1;
  if (f.today >= cfg.dailyCap) return { state: "full" };
  // Keep room for the biggest chest, so the budget is never overshot.
  if (f.issuedG + Math.max(...cfg.tiers.map((t) => t.g)) > cfg.budgetG) return { state: "full" };
  return { state: "ready", attempt };
}

/** The WAT (UTC+1) calendar day, for the daily cap. */
export function watDay(nowS: number): string {
  return new Date((nowS + 3600) * 1000).toISOString().slice(0, 10);
}

/** What the player signs to ask for their chest. Bound to wallet and time. */
export function welcomeMessage(address: string, timestamp: number): string {
  return `GoodDrops: hide my welcome chest\nWallet: ${address.toLowerCase()}\nTime: ${timestamp}`;
}

/** Player-facing name of the chest's spot. */
export function spotLabel(kind: SpotKind, name?: string): string {
  if (kind === "landmark" && name) return `near ${name}`;
  if (kind === "here") return "right where you are";
  return "a short walk from you";
}
