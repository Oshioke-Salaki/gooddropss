import type { Redis } from "@upstash/redis";

// An in-memory stand-in for the slice of @upstash/redis the task modules use,
// with real expiry (driven by Date.now, so vi.useFakeTimers moves it). Values
// round-trip as-is, like Upstash's automatic JSON (de)serialization. Tests only.

type Entry = { v: unknown; exp: number | null };

export function fakeRedis() {
  const m = new Map<string, Entry>();
  const now = () => Date.now();
  const live = (k: string): Entry | null => {
    const e = m.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= now()) { m.delete(k); return null; }
    return e;
  };

  const api = {
    m,
    async get<T>(k: string): Promise<T | null> { return (live(k)?.v as T) ?? null; },
    async mget<T>(...ks: string[]): Promise<T> { return ks.map((k) => live(k)?.v ?? null) as T; },
    async set(k: string, v: unknown, o?: { nx?: boolean; ex?: number }): Promise<"OK" | null> {
      if (o?.nx && live(k)) return null;
      m.set(k, { v, exp: o?.ex ? now() + o.ex * 1000 : null });
      return "OK";
    },
    async del(...ks: string[]) { let n = 0; for (const k of ks) if (live(k)) { m.delete(k); n++; } return n; },
    async getdel<T>(k: string): Promise<T | null> { const e = live(k); if (!e) return null; m.delete(k); return e.v as T; },
    async ttl(k: string) {
      const e = live(k);
      if (!e) return -2;
      return e.exp === null ? -1 : Math.ceil((e.exp - now()) / 1000);
    },
    async expire(k: string, s: number) { const e = live(k); if (!e) return 0; e.exp = now() + s * 1000; return 1; },
    async incr(k: string) { const e = live(k); const n = Number(e?.v ?? 0) + 1; m.set(k, { v: n, exp: e?.exp ?? null }); return n; },
    async decr(k: string) { const e = live(k); const n = Number(e?.v ?? 0) - 1; m.set(k, { v: n, exp: e?.exp ?? null }); return n; },
    async lpush(k: string, ...vs: unknown[]) {
      const e = live(k); const arr = (e?.v as unknown[]) ?? [];
      const next = [...vs.reverse(), ...arr]; m.set(k, { v: next, exp: e?.exp ?? null }); return next.length;
    },
    async ltrim(k: string, a: number, b: number) {
      const e = live(k); if (e) e.v = (e.v as unknown[]).slice(a, b + 1); return "OK";
    },
    async lrange<T>(k: string, a: number, b: number): Promise<T[]> {
      const arr = (live(k)?.v as T[]) ?? [];
      return arr.slice(a, b < 0 ? undefined : b + 1);
    },
  };
  return api;
}

export type FakeRedis = ReturnType<typeof fakeRedis>;
export const asRedis = (r: FakeRedis) => r as unknown as Redis;
