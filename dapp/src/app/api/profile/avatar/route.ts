import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { verifyMessage } from "viem";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { isValidAvatarPreset } from "@/lib/avatarPresets";

const redis = Redis.fromEnv({ retry: { retries: 1, backoff: () => 300 } });
const SIG_WINDOW = 24 * 60 * 60 * 1000; // 24h — cosmetic, anti-replay only

// ── POST /api/profile/avatar ────────────────────────────────────────────────
// Body: { address, avatar, signature, timestamp }
// avatar = a preset id, or "" to reset to the generated avatar. Owner-only: the
// wallet signature proves ownership, and we scope by GoodDollar root so the
// choice follows the person across linked wallets (same as username).
export async function POST(req: NextRequest) {
  let body: { address?: string; avatar?: string; signature?: string; timestamp?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }

  const { address, signature, timestamp } = body;
  const avatar = (body.avatar ?? "").trim();

  if (!address || !signature || !timestamp) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  // "" clears the avatar; anything else must be a known preset.
  if (avatar !== "" && !isValidAvatarPreset(avatar)) {
    return NextResponse.json({ error: "Unknown avatar" }, { status: 400 });
  }
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW) {
    return NextResponse.json({ error: "Signature expired — try again" }, { status: 400 });
  }

  const message = `GoodDrops: set avatar "${avatar}" at ${timestamp}`;
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  try {
    const root = await resolveIdentityRoot(address.toLowerCase());
    const key  = `gd:profile:${root}`;
    const existing = (await redis.get<Record<string, unknown>>(key)) ?? {};
    const next = { ...existing } as Record<string, unknown>;
    if (avatar) next.avatar = avatar; else delete next.avatar;
    await redis.set(key, next);
    return NextResponse.json({ avatar: avatar || null });
  } catch (e) {
    console.error("[profile/avatar]", e);
    return NextResponse.json({ error: "Storage unavailable — try again" }, { status: 503 });
  }
}
