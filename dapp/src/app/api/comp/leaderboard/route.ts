import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { getCompConfig, compPhase, tierPrizeG } from "@/lib/competition";
import { computeScores } from "@/lib/competitionV2";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// Served from Vercel's CDN (keyed by the full URL, incl. ?address) so the every-60s
// polls mostly hit the edge instead of a function. The refresh button cache-busts.
const CDN = { "Cache-Control": "public, s-maxage=110, stale-while-revalidate=300" };

interface ClaimerRef { root: string; username: string | null; referred: boolean; gG: number }

// GET /api/comp/leaderboard[?address=0x…] — public, read-only, server-authoritative.
// Rank by REACH: distinct verified people who claimed a drop you created (someone
// you also referred counts extra). The top N split the pot at the end.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);
  const address = req.nextUrl.searchParams.get("address");

  if (!redis) return NextResponse.json({ ok: false, phase: "upcoming", participants: [], you: null });

  const cfg = await getCompConfig(redis);
  const phase = compPhase(cfg, now);
  const { entries, stats } = await computeScores(cfg);

  const allRoots = [...new Set(entries.flatMap((a) => [a.root, ...a.claimers.map((c) => c.root)]))];
  const nameOf = await usernames(redis, allRoots);

  const participants = entries.map((a, i) => ({
    root: a.root,
    username: nameOf.get(a.root) ?? null,
    reach: a.reach,
    claims: a.claims,
    refs: a.refs,
    depth: a.depth,
    downline: a.downline,
    base: a.base,
    score: a.score,
    dropsClaimed: a.dropsClaimed,
    gDropped: a.gDropped,
    rank: i + 1,
    prizeG: tierPrizeG(cfg, i + 1),
    claimers: a.claimers.slice(0, 100).map((c) => ({
      root: c.root, username: nameOf.get(c.root) ?? null, referred: c.referred, gG: c.gG,
    }) as ClaimerRef),
  }));

  type P = (typeof participants)[number];
  let you: P | { root: string; username: string | null; reach: number; claims: number; refs: number; depth: number; downline: number; base: number; score: number; dropsClaimed: number; gDropped: number; rank: null; prizeG: number; claimers: ClaimerRef[] } | null = null;
  if (address && ADDR_RE.test(address)) {
    const root = await resolveIdentityRoot(address.toLowerCase());
    const idx = participants.findIndex((p) => p.root === root);
    you = idx >= 0 ? participants[idx]
      : { root, username: nameOf.get(root) ?? null, reach: 0, claims: 0, refs: 0, depth: 0, downline: 0, base: 0, score: 0, dropsClaimed: 0, gDropped: 0, rank: null, prizeG: 0, claimers: [] };
  }

  return NextResponse.json({
    ok: true, mode: "tiered", phase, stats,
    config: {
      startsAt: cfg.startsAt, endsAt: cfg.endsAt, potWei: cfg.potWei, tiers: cfg.tiers,
      minDropWei: cfg.minDropWei ?? null, downlineWeights: cfg.downlineWeights ?? null,
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
