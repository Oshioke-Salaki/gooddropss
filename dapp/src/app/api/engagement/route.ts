import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import type { HunterStreak } from "@/types";

export const runtime = "nodejs";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().split("T")[0];
}

// GET /api/engagement?address=0x...
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return NextResponse.json({ streak: null });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ streak: null });

  try {
    // Key stats by the GoodDollar identity root so a person's connected wallets
    // all share one streak (see resolveIdentityRoot).
    const root = await resolveIdentityRoot(address);
    const raw = await redis.get<string>(keys.streak(root));
    if (!raw) return NextResponse.json({ streak: { current: 0, best: 0, lastDate: "" } });
    const streak: HunterStreak = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json({ streak });
  } catch (e) {
    console.error("[engagement/get]", e);
    return NextResponse.json({ streak: null });
  }
}

// POST /api/engagement — call after a successful drop claim
// Body: { address: string }
export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ streak: null, isNewDay: false });

    // Increment the streak on the identity root, not the raw wallet, so hunting
    // from any of a person's connected wallets keeps one continuous streak.
    const root = await resolveIdentityRoot(address);
    const raw = await redis.get<string>(keys.streak(root));
    const existing: HunterStreak = raw
      ? (typeof raw === "string" ? JSON.parse(raw) : raw)
      : { current: 0, best: 0, lastDate: "" };

    const todayStr     = today();
    const yesterdayStr = yesterday();

    // Already registered a claim today — no update
    if (existing.lastDate === todayStr) {
      return NextResponse.json({ streak: existing, isNewDay: false });
    }

    const newCurrent = existing.lastDate === yesterdayStr
      ? existing.current + 1   // streak continues
      : 1;                      // streak broken or first time

    const updated: HunterStreak = {
      current:  newCurrent,
      best:     Math.max(existing.best, newCurrent),
      lastDate: todayStr,
    };

    await redis.set(keys.streak(root), JSON.stringify(updated), { ex: 60 * 60 * 24 * 365 });
    return NextResponse.json({ streak: updated, isNewDay: true });
  } catch (e) {
    console.error("[engagement/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
