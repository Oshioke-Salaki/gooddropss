import { NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";

interface LogEntry { root: string; to?: string; wei: string; tx: string; at: string; status: string }

// GET /api/comp/log — admin-only audit trail of competition payouts (newest first),
// enriched with the referrer's @username.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ entries: [] });

  const raw = (await redis.lrange<LogEntry | string>(keys.compPayoutLog(), 0, 99)) ?? [];
  const entries: LogEntry[] = raw
    .map((e) => { try { return (typeof e === "string" ? JSON.parse(e) : e) as LogEntry; } catch { return null; } })
    .filter((e): e is LogEntry => !!e && !!e.tx);

  const roots = [...new Set(entries.map((e) => e.root).filter(Boolean))];
  const profiles = roots.length
    ? await redis.mget<({ username?: string } | null)[]>(...roots.map((r) => `gd:profile:${r}`))
    : [];
  const nameOf = new Map<string, string | null>();
  roots.forEach((r, i) => nameOf.set(r, profiles[i]?.username ?? null));

  return NextResponse.json({
    entries: entries.map((e) => ({ ...e, username: nameOf.get(e.root) ?? null })),
  });
}
