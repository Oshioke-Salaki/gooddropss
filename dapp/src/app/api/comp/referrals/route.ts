import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { getRefCompConfig, refCompPhase } from "@/lib/competition";
import { computeReferralBoard } from "@/lib/competitionReferral";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// Cached at the edge like the points board, so the 60s polls mostly miss the
// function. The refresh button cache-busts with a `_` param.
const CDN = { "Cache-Control": "public, s-maxage=110, stale-while-revalidate=300" };

interface InviteeRef { root: string; username: string | null; at: number; covered: boolean }

// GET /api/comp/referrals[?address=0x…] — the REFERRAL competition leaderboard.
// Flat rate per referral, unlocked at `threshold`, first-come-first-served against
// the pot. Public, read-only, server-authoritative.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);
  const address = req.nextUrl.searchParams.get("address");

  if (!redis) return NextResponse.json({ ok: false, phase: "upcoming", participants: [], you: null });

  const cfg = await getRefCompConfig(redis);
  const { entries, stats } = await computeReferralBoard(cfg);
  const phase = refCompPhase(cfg, now, stats.slotsUsed);

  const allRoots = [...new Set(entries.flatMap((e) => [e.root, ...e.invitees.map((i) => i.root)]))];
  const nameOf = await usernames(redis, allRoots);

  const participants = entries.map((e, i) => ({
    root: e.root,
    username: nameOf.get(e.root) ?? null,
    count: e.count,
    covered: e.covered,
    unlocked: e.unlocked,
    earnedWei: e.earnedWei,
    rank: i + 1,
    invitees: e.invitees.slice(0, 100).map((iv) => ({
      root: iv.root, username: nameOf.get(iv.root) ?? null, at: iv.at, covered: iv.covered,
    }) as InviteeRef),
  }));

  type P = (typeof participants)[number];
  let you: P | { root: string; username: string | null; count: number; covered: number; unlocked: boolean; earnedWei: string; rank: null; invitees: InviteeRef[] } | null = null;
  if (address && ADDR_RE.test(address)) {
    const root = await resolveIdentityRoot(address.toLowerCase());
    const idx = participants.findIndex((p) => p.root === root);
    you = idx >= 0 ? participants[idx]
      : { root, username: nameOf.get(root) ?? null, count: 0, covered: 0, unlocked: false, earnedWei: "0", rank: null, invitees: [] };
  }

  return NextResponse.json({
    ok: true, phase, stats,
    config: {
      startsAt: cfg.startsAt, endsAt: cfg.endsAt, potWei: cfg.potWei,
      perReferralWei: cfg.perReferralWei, threshold: cfg.threshold,
    },
    participants, you,
  }, { headers: CDN });
}

// Batch-resolve @usernames for a set of identity roots.
async function usernames(redis: NonNullable<ReturnType<typeof getRedis>>, roots: string[]): Promise<Map<string, string | null>> {
  const nameOf = new Map<string, string | null>();
  if (roots.length === 0) return nameOf;
  const profiles = await redis.mget<({ username?: string } | null)[]>(...roots.map((r) => `gd:profile:${r}`));
  roots.forEach((r, i) => nameOf.set(r, profiles[i]?.username ?? null));
  return nameOf;
}
