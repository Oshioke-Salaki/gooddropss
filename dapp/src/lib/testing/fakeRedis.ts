// An in-memory stand-in for the slice of @upstash/redis the referral code uses.
// Follows Upstash's behaviour where it matters to correctness:
//   • SET returns "OK" or null (NX that lost), honours EX/PX expiry;
//   • GET auto-parses JSON values (Upstash deserialises by default);
//   • sorted sets keep scores, ZADD NX never moves an existing score.
// Test-only. Not imported by app code.

type Entry = { kind: "str"; v: string; exp?: number } | { kind: "set"; v: Set<string> } | { kind: "zset"; v: Map<string, number> };

export class FakeRedis {
  private m = new Map<string, Entry>();
  /** Milliseconds "now" for expiry. Tests can move it. */
  clock = 0;
  /** Every command name, in order: lets a test assert nothing was written. */
  log: string[] = [];

  private live(key: string): Entry | undefined {
    const e = this.m.get(key);
    if (e && e.kind === "str" && e.exp !== undefined && e.exp <= this.clock) { this.m.delete(key); return undefined; }
    return e;
  }
  private zset(key: string, create = false): Map<string, number> | undefined {
    const e = this.live(key);
    if (e?.kind === "zset") return e.v;
    if (!create) return undefined;
    const v = new Map<string, number>(); this.m.set(key, { kind: "zset", v }); return v;
  }
  private set_(key: string, create = false): Set<string> | undefined {
    const e = this.live(key);
    if (e?.kind === "set") return e.v;
    if (!create) return undefined;
    const v = new Set<string>(); this.m.set(key, { kind: "set", v }); return v;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.log.push("get");
    const e = this.live(key);
    if (!e || e.kind !== "str") return null;
    try { return JSON.parse(e.v) as T; } catch { return e.v as T; }
  }
  async set(key: string, value: unknown, opts: { nx?: boolean; ex?: number; px?: number } = {}): Promise<"OK" | null> {
    this.log.push("set");
    if (opts.nx && this.live(key)) return null;
    const v = typeof value === "string" ? value : JSON.stringify(value);
    const exp = opts.ex ? this.clock + opts.ex * 1000 : opts.px ? this.clock + opts.px : undefined;
    this.m.set(key, { kind: "str", v, exp });
    return "OK";
  }
  async del(...ks: string[]): Promise<number> {
    this.log.push("del");
    let n = 0; for (const k of ks) if (this.m.delete(k)) n++; return n;
  }
  async incr(key: string): Promise<number> {
    this.log.push("incr");
    const e = this.live(key);
    const n = (e && e.kind === "str" ? Number(e.v) : 0) + 1;
    this.m.set(key, { kind: "str", v: String(n), exp: e && e.kind === "str" ? e.exp : undefined });
    return n;
  }
  async incrby(key: string, by: number): Promise<number> {
    this.log.push("incrby");
    const e = this.live(key);
    const n = (e && e.kind === "str" ? Number(e.v) : 0) + by;
    this.m.set(key, { kind: "str", v: String(n), exp: e && e.kind === "str" ? e.exp : undefined });
    return n;
  }
  async expire(key: string, s: number): Promise<number> {
    this.log.push("expire");
    const e = this.live(key); if (!e || e.kind !== "str") return 0; e.exp = this.clock + s * 1000; return 1;
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    this.log.push("sadd");
    const s = this.set_(key, true)!; let n = 0;
    for (const x of members) if (!s.has(x)) { s.add(x); n++; }
    return n;
  }
  async scard(key: string): Promise<number> { this.log.push("scard"); return this.set_(key)?.size ?? 0; }
  async smembers<T = string[]>(key: string): Promise<T> { this.log.push("smembers"); return [...(this.set_(key) ?? [])] as T; }
  async srandmember<T = string[]>(key: string, count: number): Promise<T> {
    this.log.push("srandmember"); return [...(this.set_(key) ?? [])].slice(0, count) as T;
  }
  async zadd(key: string, a: { nx?: boolean } | { score: number; member: string }, b?: { score: number; member: string }): Promise<number> {
    this.log.push("zadd");
    const opts = b ? (a as { nx?: boolean }) : {};
    const entry = (b ?? a) as { score: number; member: string };
    const z = this.zset(key, true)!;
    if (z.has(entry.member)) { if (!opts.nx) z.set(entry.member, entry.score); return 0; }
    z.set(entry.member, entry.score); return 1;
  }
  async zrem(key: string, ...members: string[]): Promise<number> {
    this.log.push("zrem");
    const z = this.zset(key); if (!z) return 0; let n = 0; for (const x of members) if (z.delete(x)) n++; return n;
  }
  async zincrby(key: string, by: number, member: string): Promise<number> {
    this.log.push("zincrby");
    const z = this.zset(key, true)!; const v = (z.get(member) ?? 0) + by; z.set(member, v); return v;
  }
  async zscore(key: string, member: string): Promise<number | null> { return this.zset(key)?.get(member) ?? null; }
  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    this.log.push("zcount");
    const lo = min === "-inf" ? -Infinity : Number(min), hi = max === "+inf" ? Infinity : Number(max);
    return [...(this.zset(key)?.values() ?? [])].filter((s) => s >= lo && s <= hi).length;
  }
  async zrange<T = string[]>(key: string, start: number, stop: number): Promise<T> {
    this.log.push("zrange");
    const rows = [...(this.zset(key)?.entries() ?? [])].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([m]) => m);
    return rows.slice(start, stop < 0 ? rows.length + stop + 1 : stop + 1) as T;
  }
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    this.log.push("zremrangebyscore");
    const z = this.zset(key); if (!z) return 0; let n = 0;
    for (const [m, s] of z) if (s >= min && s <= max) { z.delete(m); n++; }
    return n;
  }

  // ── Test helpers (not Redis) ──
  has(key: string): boolean { return !!this.live(key); }
  members(key: string): string[] { return [...(this.set_(key) ?? [])].sort(); }
  zmembers(key: string): [string, number][] { return [...(this.zset(key)?.entries() ?? [])].sort((a, b) => a[1] - b[1]); }
  writes(): string[] { return this.log.filter((c) => !["get", "scard", "smembers", "srandmember", "zcount", "zrange"].includes(c)); }
}
