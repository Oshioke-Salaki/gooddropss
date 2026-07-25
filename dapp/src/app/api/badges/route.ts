import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { fetchHunterProfile } from "@/lib/subgraph";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import {
  BUILTIN_BADGES, evaluateBadges, isValidRule,
  type BadgeDef, type BadgeSetDef,
} from "@/lib/badges";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function parseDef(raw: unknown): BadgeDef | null {
  try {
    const d = (typeof raw === "string" ? JSON.parse(raw) : raw) as BadgeDef;
    if (!d?.id || !d.name || !isValidRule(d.rule)) return null;
    return d;
  } catch { return null; }
}

async function loadDefs(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<BadgeDef[]> {
  const custom = (await redis.hgetall<Record<string, string>>(keys.badgeDefs())) ?? {};
  const customDefs = Object.values(custom).map(parseDef).filter((d): d is BadgeDef => d !== null);
  return [...BUILTIN_BADGES, ...customDefs];
}

async function loadSets(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<BadgeSetDef[]> {
  const raw = (await redis.hgetall<Record<string, string>>(keys.badgeSets())) ?? {};
  return Object.values(raw)
    .map((r) => { try { return (typeof r === "string" ? JSON.parse(r) : r) as BadgeSetDef; } catch { return null; } })
    .filter((s): s is BadgeSetDef => !!s?.id && Array.isArray(s.badgeIds));
}

// GET /api/badges?address=0x…
//
// Lazy evaluate-and-award: recompute eligibility from the subgraph (identity-
// scoped, so ALL of a person's linked wallets count) and award anything new.
// Earned badges are append-only — re-evaluation never revokes. Returns the full
// wall (earned + locked), set progress, holder counts, and what was newly
// earned on THIS call so the client can celebrate.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !ADDR_RE.test(address))
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ badges: [], sets: [], newlyEarned: [] });

  try {
    const [root, profile, defs, sets] = await Promise.all([
      resolveIdentityRoot(address),
      fetchHunterProfile(address),
      loadDefs(redis),
      loadSets(redis),
    ]);

    // Streak — best-effort; badge evaluation must not fail if it's missing.
    let bestStreak = 0;
    try {
      const raw = await redis.get<string | { best?: number }>(keys.streak(root));
      const s = typeof raw === "string" ? JSON.parse(raw) : raw;
      bestStreak = Number(s?.best ?? 0) || 0;
    } catch { /* stays 0 */ }

    const eligible = profile
      ? evaluateBadges(defs, { claimed: profile.dropsClaimed, created: profile.dropsCreated, bestStreak })
      : []; // subgraph down → show what's stored, award nothing (never guess)

    // Already earned (zset id → earnedAt seconds) + on-chain-minted set.
    const [earnedRaw, mintedArr] = await Promise.all([
      redis.zrange<(string | number)[]>(keys.badgesOf(root), 0, -1, { withScores: true }),
      redis.smembers(keys.badgeMinted(root)),
    ]);
    const earnedAt = new Map<string, number>();
    for (let i = 0; i < (earnedRaw ?? []).length; i += 2) earnedAt.set(String(earnedRaw![i]), Number(earnedRaw![i + 1]));
    const minted = new Set((mintedArr ?? []).map(String));

    // Award anything newly eligible (append-only).
    const now = Math.floor(Date.now() / 1000);
    const newlyEarned = eligible.filter((id) => !earnedAt.has(id));
    if (newlyEarned.length > 0) {
      await Promise.all(newlyEarned.flatMap((id) => [
        redis.zadd(keys.badgesOf(root), { score: now, member: id }),
        redis.sadd(keys.badgeHolders(id), root),
      ]));
      newlyEarned.forEach((id) => earnedAt.set(id, now));
    }

    // Rarity: holder counts per def (small def count — parallel scards are fine).
    const holders = await Promise.all(defs.map((d) => redis.scard(keys.badgeHolders(d.id)).catch(() => 0)));

    const badges = defs.map((d, i) => ({
      id: d.id,
      name: d.name,
      emoji: d.emoji,
      description: d.description,
      builtin: !!d.builtin,
      earned: earnedAt.has(d.id),
      earnedAt: earnedAt.get(d.id) ?? null,
      holders: holders[i] ?? 0,
      minted: minted.has(d.id),
    }));

    return NextResponse.json({ badges, sets, newlyEarned });
  } catch (e) {
    console.error("[badges/get]", e);
    return NextResponse.json({ badges: [], sets: [], newlyEarned: [] });
  }
}
