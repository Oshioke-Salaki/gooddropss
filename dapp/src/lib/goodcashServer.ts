// Server only. Talks to GoodCash with our secret key and keeps our own records:
// the per-person daily cap and the central cash-out total.
//
// Every number in the central total comes from GoodCash's own server (a signed
// webhook, or a status read with our secret key), never from a browser, and a
// cash out is counted once only, when GoodCash says the bank was paid.
//
// Test keys never touch production storage: in test mode everything lives in
// this process's memory. The dev server shares production Redis, so this keeps
// test cash outs out of the real total.

import { createHmac, timingSafeEqual } from "crypto";
import type { Redis } from "@upstash/redis";
import { getRedis } from "@/lib/redis";
import type { CashOutStatus } from "@/lib/goodcash";

const API = "https://api.goodcash.xyz";

export type Mode = "live" | "test";

export function gcConfig(): { key: string; mode: Mode } | null {
  const key = process.env.GOODCASH_SECRET_KEY?.trim();
  if (!key) return null;
  if (key.startsWith("gc_sk_live_")) return { key, mode: "live" };
  if (key.startsWith("gc_sk_test_")) return { key, mode: "test" };
  return null; // a publishable key or anything else: refuse to run
}

/** Whether the app should offer cash out. Test mode only where we ask for it. */
export function cashOutEnabled(): boolean {
  const c = gcConfig();
  if (!c) return false;
  return c.mode === "live" || process.env.GOODCASH_SHOW_TEST === "1";
}

export interface GcError { code: string; message: string; status: number; detail?: string }
export type GcResult<T> = { ok: true; data: T; status: number } | { ok: false; error: GcError };

const FALLBACK_MSG = "Withdrawals are busy right now. Please try again in a moment.";

/** One GoodCash call. Never throws; errors come back in GoodCash's own plain words. */
export async function gc<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string; timeoutMs?: number } = {}): Promise<GcResult<T>> {
  const cfg = gcConfig();
  if (!cfg) return { ok: false, error: { code: "not_configured", message: "Withdrawals aren't available yet.", status: 503 } };
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.key}`, Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      cache: "no-store",
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* not JSON: e.g. a firewall page */ }
    if (!res.ok) {
      const e = (body as { error?: { code?: string; message?: string; detail?: string } } | null)?.error;
      const detail = e?.detail ?? (e ? undefined : JSON.stringify({
        url: `${API}${path}`, method: init.method ?? "GET", at: new Date().toISOString(), status: res.status,
        cfRay: res.headers.get("cf-ray"), server: res.headers.get("server"), cfMitigated: res.headers.get("cf-mitigated"),
        body: text,
      }));
      console.warn(`[goodcash] ${path} ${res.status} ${e?.code ?? "non-json"}: ${detail ?? ""}`);
      return { ok: false, error: { code: e?.code ?? "unavailable", message: e?.message ?? FALLBACK_MSG, status: res.status, detail } };
    }
    return { ok: true, data: body as T, status: res.status };
  } catch (e) {
    console.warn(`[goodcash] ${path} failed`, e);
    return { ok: false, error: { code: "network_error", message: FALLBACK_MSG, status: 503 } };
  }
}

// ── GoodCash's cash-out object (only the fields we use) ───────────────────────

export interface GcCashOut {
  id: string;
  mode: Mode;
  status: CashOutStatus;
  wallet: string;
  amountG: string;
  receive?: { naira?: number; minimumNaira?: number };
  partnerRef?: string | null;
  txHash?: string | null;
  createdAt: string;
  paidAt?: string | null;
  expiresAt?: string;
}

// ── Storage: Redis when live, memory when testing ─────────────────────────────

interface Store {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, opt?: { nx?: boolean; ex?: number }): Promise<boolean>;
  del(k: string): Promise<void>;
  hset(k: string, field: string, v: string, ex?: number): Promise<void>;
  hgetall(k: string): Promise<Record<string, string>>;
  hincrby(k: string, field: string, by: number): Promise<void>;
  sadd(k: string, v: string): Promise<void>;
  scard(k: string): Promise<number>;
  lpush(k: string, v: string, max: number): Promise<void>;
  lrange(k: string, n: number): Promise<string[]>;
  incr(k: string, ex: number): Promise<number>;
}

const str = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));

class RedisStore implements Store {
  constructor(private r: Redis) {}
  async get(k: string) { return str(await this.r.get(k)); }
  async set(k: string, v: string, opt: { nx?: boolean; ex?: number } = {}) {
    const res = opt.nx
      ? await this.r.set(k, v, opt.ex ? { nx: true, ex: opt.ex } : { nx: true })
      : await this.r.set(k, v, opt.ex ? { ex: opt.ex } : undefined);
    return res === "OK";
  }
  async del(k: string) { await this.r.del(k); }
  async hset(k: string, f: string, v: string, ex?: number) { await this.r.hset(k, { [f]: v }); if (ex) await this.r.expire(k, ex); }
  async hgetall(k: string) {
    const h = (await this.r.hgetall<Record<string, unknown>>(k)) ?? {};
    return Object.fromEntries(Object.entries(h).map(([f, v]) => [f, str(v) ?? ""]));
  }
  async hincrby(k: string, f: string, by: number) { await this.r.hincrby(k, f, by); }
  async sadd(k: string, v: string) { await this.r.sadd(k, v); }
  async scard(k: string) { return this.r.scard(k); }
  async lpush(k: string, v: string, max: number) { await this.r.lpush(k, v); await this.r.ltrim(k, 0, max - 1); }
  async lrange(k: string, n: number) { return ((await this.r.lrange(k, 0, n - 1)) ?? []).map((v) => str(v) ?? ""); }
  async incr(k: string, ex: number) { const n = await this.r.incr(k); if (n === 1) await this.r.expire(k, ex); return n; }
}

/** Test mode only. Lives as long as the server process (enough to test with). */
class MemoryStore implements Store {
  private kv = new Map<string, { v: string; exp: number }>();
  private h = new Map<string, Map<string, string>>();
  private s = new Map<string, Set<string>>();
  private l = new Map<string, string[]>();
  private live(k: string) { const e = this.kv.get(k); if (e && e.exp && e.exp < Date.now()) { this.kv.delete(k); return null; } return e ?? null; }
  async get(k: string) { return this.live(k)?.v ?? null; }
  async set(k: string, v: string, opt: { nx?: boolean; ex?: number } = {}) {
    if (opt.nx && this.live(k)) return false;
    this.kv.set(k, { v, exp: opt.ex ? Date.now() + opt.ex * 1000 : 0 });
    return true;
  }
  async del(k: string) { this.kv.delete(k); }
  async hset(k: string, f: string, v: string) { (this.h.get(k) ?? this.h.set(k, new Map()).get(k)!).set(f, v); }
  async hgetall(k: string) { return Object.fromEntries(this.h.get(k) ?? []); }
  async hincrby(k: string, f: string, by: number) { const m = this.h.get(k) ?? this.h.set(k, new Map()).get(k)!; m.set(f, String(Number(m.get(f) ?? 0) + by)); }
  async sadd(k: string, v: string) { (this.s.get(k) ?? this.s.set(k, new Set()).get(k)!).add(v); }
  async scard(k: string) { return this.s.get(k)?.size ?? 0; }
  async lpush(k: string, v: string, max: number) { const a = this.l.get(k) ?? []; a.unshift(v); this.l.set(k, a.slice(0, max)); }
  async lrange(k: string, n: number) { return (this.l.get(k) ?? []).slice(0, n); }
  async incr(k: string, ex: number) { const n = Number((await this.get(k)) ?? 0) + 1; await this.set(k, String(n), { ex }); return n; }
}

const g = globalThis as unknown as { __gcMemStore?: MemoryStore };

export function store(): Store | null {
  const cfg = gcConfig();
  if (!cfg) return null;
  if (cfg.mode === "test") return (g.__gcMemStore ??= new MemoryStore());
  const r = getRedis();
  return r ? new RedisStore(r) : null;
}

// ── Keys ──────────────────────────────────────────────────────────────────────

const K = {
  order: (id: string) => `gd:cashout:o:${id}`,                         // JSON OrderRecord
  day: (root: string, day: string) => `gd:cashout:day:${root.toLowerCase()}:${day}`, // hash id → JSON {wei, exp, st}
  counted: (id: string) => `gd:cashout:counted:${id}`,                 // NX: counted in the total
  totals: () => `gd:cashout:totals`,                                    // hash count, microG, kobo
  people: () => `gd:cashout:people`,                                    // set of identity roots who were paid
  paidLog: () => `gd:cashout:paid`,                                     // list of PaidRecord, newest first
  event: (id: string) => `gd:cashout:evt:${id}`,                       // NX: webhook event handled
  lock: (root: string) => `gd:cashout:lock:${root.toLowerCase()}`,     // NX: one new cash out at a time per person
  rl: (kind: string, who: string) => `gd:cashout:rl:${kind}:${who.toLowerCase()}`,
};

/** Lagos calendar day, so "per day" means a Nigerian day. */
export const lagosDay = (ms = Date.now()) => new Date(ms + 3_600_000).toISOString().slice(0, 10);

export interface OrderRecord {
  id: string;
  wallet: string;
  root: string;
  day: string;
  amountG: string;
  amountWei: string;
  naira: number;
  nairaPerDollar: number;
  accountName: string;
  bankName: string;
  accountLast4: string;
  createdAt: string;
}

export interface PaidRecord {
  id: string;
  wallet: string;
  root: string;
  amountG: string;
  naira: number;
  nairaPerDollar: number;
  txHash: string | null;
  paidAt: string;
}

export async function saveOrder(s: Store, o: OrderRecord) {
  await s.set(K.order(o.id), JSON.stringify(o), { ex: 400 * 86_400 });
}

export async function getOrder(s: Store, id: string): Promise<OrderRecord | null> {
  const raw = await s.get(K.order(id));
  try { return raw ? (JSON.parse(raw) as OrderRecord) : null; } catch { return null; }
}

// ── The daily cap ─────────────────────────────────────────────────────────────

const COUNTS = new Set<CashOutStatus>(["sent", "processing", "paid"]);

/** G$ (in wei) this person has cashed out, or is about to, today. */
export async function usedTodayWei(s: Store, root: string, now = Date.now()): Promise<bigint> {
  const entries = await s.hgetall(K.day(root, lagosDay(now)));
  let used = 0n;
  for (const raw of Object.values(entries)) {
    try {
      const e = JSON.parse(raw) as { wei: string; exp: number; st: CashOutStatus };
      if (COUNTS.has(e.st) || (e.st === "awaiting_signature" && e.exp > now)) used += BigInt(e.wei);
    } catch { /* skip a bad row */ }
  }
  return used;
}

export async function markDay(s: Store, root: string, day: string, id: string, wei: string, exp: number, st: CashOutStatus) {
  await s.hset(K.day(root, day), id, JSON.stringify({ wei, exp, st }), 3 * 86_400);
}

/** One new cash out at a time per person, so two taps can't both pass the cap. */
export async function withPersonLock<T>(s: Store, root: string, fn: () => Promise<T>): Promise<T | "busy"> {
  if (!(await s.set(K.lock(root), "1", { nx: true, ex: 30 }))) return "busy";
  try { return await fn(); } finally { await s.del(K.lock(root)).catch(() => {}); }
}

/** A per-key counter for rate limits. Returns true while under `max`. */
export async function underLimit(s: Store, kind: string, who: string, max: number, windowS: number): Promise<boolean> {
  return (await s.incr(K.rl(kind, who), windowS)) <= max;
}

// ── Keeping our records in step with GoodCash ─────────────────────────────────

/**
 * Apply GoodCash's view of a cash out (from a verified webhook or a secret-key
 * read): update the daily cap and, the first time it is paid, the central total.
 */
export async function syncCashOut(s: Store, c: GcCashOut): Promise<OrderRecord | null> {
  const o = await getOrder(s, c.id);
  if (!o) return null; // not one of ours
  await markDay(s, o.root, o.day, o.id, o.amountWei, Date.parse(c.expiresAt ?? "") || 0, c.status);
  if (c.status === "paid") await countPaid(s, o, c);
  return o;
}

async function countPaid(s: Store, o: OrderRecord, c: GcCashOut) {
  if (!(await s.set(K.counted(o.id), "1", { nx: true }))) return; // already counted
  const naira = typeof c.receive?.naira === "number" ? c.receive.naira : o.naira;
  const microG = Math.round(Number(c.amountG || o.amountG) * 1e6);
  const kobo = Math.round(naira * 100);
  await s.hincrby(K.totals(), "count", 1);
  await s.hincrby(K.totals(), "microG", microG);
  await s.hincrby(K.totals(), "kobo", kobo);
  await s.sadd(K.people(), o.root);
  const rec: PaidRecord = {
    id: o.id, wallet: o.wallet, root: o.root, amountG: c.amountG || o.amountG, naira,
    nairaPerDollar: o.nairaPerDollar, txHash: c.txHash ?? null, paidAt: c.paidAt ?? new Date().toISOString(),
  };
  await s.lpush(K.paidLog(), JSON.stringify(rec), 5000);
}

export interface Totals { count: number; g: number; naira: number; people: number; recent: PaidRecord[] }

export async function totals(s: Store, recentN = 50): Promise<Totals> {
  const h = await s.hgetall(K.totals());
  const recent = (await s.lrange(K.paidLog(), recentN)).flatMap((r) => { try { return [JSON.parse(r) as PaidRecord]; } catch { return []; } });
  return {
    count: Number(h.count ?? 0),
    g: Number(h.microG ?? 0) / 1e6,
    naira: Number(h.kobo ?? 0) / 100,
    people: await s.scard(K.people()),
    recent,
  };
}

/** True the first time we see this webhook event id. */
export async function firstSight(s: Store, eventId: string): Promise<boolean> {
  return s.set(K.event(eventId), "1", { nx: true, ex: 30 * 86_400 });
}

// ── Webhook signatures ────────────────────────────────────────────────────────

/** GoodCash-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>, within 5 minutes. */
export function verifySignature(raw: string, header: string | null, secret: string, nowS = Date.now() / 1000): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(nowS - Number(m[1])) > 300) return false;
  const want = createHmac("sha256", secret).update(`${m[1]}.${raw}`).digest("hex");
  return timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
}

// ── Shared by the routes ──────────────────────────────────────────────────────

export interface GcBank { code: string; name: string; popular?: boolean }
export interface GcLimits { minimumG: number; maximumG: number; feePercent: number }

let bankCache: { at: number; mode: Mode; banks: GcBank[] } | null = null;

/** The bank list changes rarely: keep it for an hour per server instance. */
export async function banks(): Promise<GcResult<GcBank[]>> {
  const mode = gcConfig()?.mode;
  if (bankCache && bankCache.mode === mode && Date.now() - bankCache.at < 3_600_000) {
    return { ok: true, data: bankCache.banks, status: 200 };
  }
  const r = await gc<{ data: GcBank[] }>("/v1/banks");
  if (!r.ok) return r;
  const list = (r.data.data ?? []).filter((b) => b && typeof b.code === "string" && typeof b.name === "string");
  if (mode) bankCache = { at: Date.now(), mode, banks: list };
  return { ok: true, data: list, status: 200 };
}

export const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
export const AMOUNT_RE = /^\d{1,12}(\.\d{1,6})?$/;
export const ACCOUNT_RE = /^\d{10}$/;
export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** What the app sees for one cash out. Bank details only from our own record. */
export function toView(c: GcCashOut, o: Partial<OrderRecord> | null) {
  return {
    id: c.id,
    status: c.status,
    amountG: c.amountG,
    naira: typeof c.receive?.naira === "number" ? c.receive.naira : (o?.naira ?? 0),
    txHash: c.txHash ?? null,
    createdAt: c.createdAt,
    paidAt: c.paidAt ?? null,
    ...(o?.accountName ? { accountName: o.accountName, bankName: o.bankName, accountLast4: o.accountLast4 } : {}),
  };
}

// ── Webhook secret ────────────────────────────────────────────────────────────
// Set GOODCASH_WEBHOOK_SECRET by hand, or let an admin press "Connect webhook":
// the server registers our URL with its own key and keeps the secret GoodCash
// returns (shown once) in storage, so no person ever has to copy either secret.

const WHSEC_KEY = (mode: Mode) => `gd:cashout:whsec:${mode}`;

export async function webhookSecret(): Promise<string | null> {
  const env = process.env.GOODCASH_WEBHOOK_SECRET?.trim();
  if (env) return env;
  const cfg = gcConfig();
  const s = store();
  if (!cfg || !s) return null;
  return s.get(WHSEC_KEY(cfg.mode));
}

export async function connectWebhook(url: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const cfg = gcConfig();
  const s = store();
  if (!cfg || !s) return { ok: false, error: "Withdrawals aren't configured." };
  const current = await gc<{ url: string | null; hasSecret?: boolean }>("/v1/webhooks");
  if (!current.ok) return { ok: false, error: current.error.message };
  const have = await webhookSecret();
  // A secret is only ever shown once: rotate if GoodCash has one we don't.
  const rotate = !!current.data.hasSecret && !have;
  const r = await gc<{ url: string; secret?: string }>("/v1/webhooks", { method: "PUT", body: { url, ...(rotate ? { rotateSecret: true } : {}) } });
  if (!r.ok) return { ok: false, error: r.error.message };
  if (r.data.secret) await s.set(WHSEC_KEY(cfg.mode), r.data.secret);
  if (!r.data.secret && !have) return { ok: false, error: "GoodCash didn't return a signing secret. Try again." };
  return { ok: true, url: r.data.url };
}

/** For the admin card: is everything in place? Never returns a secret. */
export async function cashOutHealth() {
  const cfg = gcConfig();
  if (!cfg) return { configured: false as const };
  const [partner, hook] = await Promise.all([
    gc<{ feePercent?: number; name?: string }>("/v1/partner"),
    gc<{ url: string | null; hasSecret?: boolean }>("/v1/webhooks"),
  ]);
  return {
    configured: true as const,
    mode: cfg.mode,
    partnerName: partner.ok ? partner.data.name ?? null : null,
    partnerFeePercent: partner.ok ? partner.data.feePercent ?? 0 : null,
    webhookUrl: hook.ok ? hook.data.url : null,
    webhookReady: hook.ok && !!hook.data.url && !!(await webhookSecret()),
    // Admin only: GoodCash's raw answer when it refuses us (never shown to users).
    problem: partner.ok ? null : { status: partner.error.status, code: partner.error.code, detail: partner.error.detail ?? null },
  };
}
