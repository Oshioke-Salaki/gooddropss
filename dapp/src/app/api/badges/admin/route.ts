import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { BADGE_ID_RE, isBuiltinBadgeId, isValidRule, BUILTIN_BADGES, type BadgeDef, type BadgeSetDef } from "@/lib/badges";

export const runtime = "nodejs";

// GET /api/badges/admin — all defs (builtin + custom) + sets + holder counts.
export async function GET() {
  if (!(await isAdminAuthed()))
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ builtins: BUILTIN_BADGES, customs: [], sets: [] });
  try {
    const [customRaw, setsRaw] = await Promise.all([
      redis.hgetall<Record<string, string>>(keys.badgeDefs()),
      redis.hgetall<Record<string, string>>(keys.badgeSets()),
    ]);
    const parse = <T,>(v: unknown): T | null => { try { return (typeof v === "string" ? JSON.parse(v) : v) as T; } catch { return null; } };
    const customs = Object.values(customRaw ?? {}).map((v) => parse<BadgeDef>(v)).filter((b): b is BadgeDef => !!b?.id);
    const sets = Object.values(setsRaw ?? {}).map((v) => parse<BadgeSetDef>(v)).filter((s): s is BadgeSetDef => !!s?.id);
    const all = [...BUILTIN_BADGES, ...customs];
    const holders = await Promise.all(all.map((b) => redis.scard(keys.badgeHolders(b.id)).catch(() => 0)));
    const holderMap = Object.fromEntries(all.map((b, i) => [b.id, holders[i] ?? 0]));
    return NextResponse.json({ builtins: BUILTIN_BADGES, customs, sets, holders: holderMap });
  } catch (e) {
    console.error("[badges/admin GET]", e);
    return NextResponse.json({ builtins: BUILTIN_BADGES, customs: [], sets: [], holders: {} });
  }
}

// POST /api/badges/admin — create/update/delete custom badges & sets.
// Admin-cookie gated (same boundary as the rest of the console). Builtins are
// code-defined and immutable — customs may not collide with their ids.
// Body: { op: "badge:upsert"|"badge:delete"|"set:upsert"|"set:delete", ... }
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed()))
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: { op?: string; badge?: BadgeDef; set?: BadgeSetDef; id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  try {
    switch (body.op) {
      case "badge:upsert": {
        const b = body.badge;
        if (!b || typeof b.id !== "string" || !BADGE_ID_RE.test(b.id))
          return NextResponse.json({ error: "Invalid badge id (lowercase slug)" }, { status: 400 });
        if (isBuiltinBadgeId(b.id))
          return NextResponse.json({ error: "That id belongs to a built-in badge" }, { status: 400 });
        if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 40)
          return NextResponse.json({ error: "Name required (max 40 chars)" }, { status: 400 });
        if (typeof b.emoji !== "string" || !b.emoji || b.emoji.length > 8)
          return NextResponse.json({ error: "Emoji required" }, { status: 400 });
        if (typeof b.description !== "string" || b.description.length > 160)
          return NextResponse.json({ error: "Description max 160 chars" }, { status: 400 });
        if (!isValidRule(b.rule))
          return NextResponse.json({ error: "Invalid rule" }, { status: 400 });
        const def: BadgeDef = {
          id: b.id, name: b.name.trim(), emoji: b.emoji,
          description: b.description.trim(), rule: b.rule,
        };
        await redis.hset(keys.badgeDefs(), { [def.id]: JSON.stringify(def) });
        return NextResponse.json({ ok: true, badge: def });
      }
      case "badge:delete": {
        const id = body.id;
        if (typeof id !== "string" || isBuiltinBadgeId(id))
          return NextResponse.json({ error: "Can't delete that" }, { status: 400 });
        await redis.hdel(keys.badgeDefs(), id);
        // Earned copies stay in people's walls-of-record (append-only), but the
        // def is gone so it stops being displayed or awarded.
        return NextResponse.json({ ok: true });
      }
      case "set:upsert": {
        const s = body.set;
        if (!s || typeof s.id !== "string" || !BADGE_ID_RE.test(s.id))
          return NextResponse.json({ error: "Invalid set id (lowercase slug)" }, { status: 400 });
        if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 40)
          return NextResponse.json({ error: "Name required (max 40 chars)" }, { status: 400 });
        if (!Array.isArray(s.badgeIds) || s.badgeIds.length < 2 || s.badgeIds.length > 20)
          return NextResponse.json({ error: "A set needs 2–20 badges" }, { status: 400 });
        // Every referenced badge must exist (builtin or custom).
        const custom = (await redis.hgetall<Record<string, string>>(keys.badgeDefs())) ?? {};
        const known = new Set([...BUILTIN_BADGES.map((b) => b.id), ...Object.keys(custom)]);
        const missing = s.badgeIds.filter((id) => !known.has(id));
        if (missing.length)
          return NextResponse.json({ error: `Unknown badges: ${missing.join(", ")}` }, { status: 400 });
        const def: BadgeSetDef = {
          id: s.id, name: s.name.trim(),
          emoji: typeof s.emoji === "string" && s.emoji ? s.emoji.slice(0, 8) : "🏆",
          description: typeof s.description === "string" ? s.description.slice(0, 160) : "",
          badgeIds: [...new Set(s.badgeIds)],
        };
        await redis.hset(keys.badgeSets(), { [def.id]: JSON.stringify(def) });
        return NextResponse.json({ ok: true, set: def });
      }
      case "set:delete": {
        if (typeof body.id !== "string") return NextResponse.json({ error: "Missing id" }, { status: 400 });
        await redis.hdel(keys.badgeSets(), body.id);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown op" }, { status: 400 });
    }
  } catch (e) {
    console.error("[badges/admin]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
