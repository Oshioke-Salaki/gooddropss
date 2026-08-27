import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { getCompConfig, owedWei, compPhase, windowScoreRange } from "@/lib/competition";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

interface Invitee { root: string; username: string | null }
interface Participant {
  root: string;
  username: string | null;
  referralCount: number;
  owedWei: string;
  paidWei: string;
  outstandingWei: string;
  invitees: Invitee[];
}

// GET /api/comp/leaderboard[?address=0x…] — public, read-only. All amounts are
// computed here (server-authoritative); the page only renders them. When an
// address is supplied, a `you` block with that person's stats + rank is included.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);

  if (!redis) {
    return NextResponse.json({ ok: false, phase: "upcoming", participants: [], potSpentWei: "0", you: null });
  }

  const cfg = await getCompConfig(redis);
  const spent = BigInt((await redis.get<string>(keys.compPotSpent())) ?? "0");
  const phase = compPhase(cfg, spent, now);
  const wr = windowScoreRange(cfg);

  const roots = (await redis.smembers(keys.compParticipants())) ?? [];

  // Per participant: in-window count, invitee roots, and amount paid — in parallel.
  const raw = await Promise.all(roots.map(async (root) => {
    const [count, invitees, paidStr] = await Promise.all([
      redis.zcount(keys.referralCredited(root), wr.min, wr.max),
      redis.zrange<string[]>(keys.referralCredited(root), wr.min, wr.max, { byScore: true }),
      redis.get<string>(keys.compPaid(root)),
    ]);
    return { root, count: count ?? 0, invitees: (invitees ?? []).slice(0, 100), paid: BigInt(paidStr ?? "0") };
  }));

  const rows = raw.filter((r) => r.count > 0);

  // Resolve @usernames for every referrer + invitee in a single batched read.
  const allRoots = [...new Set(rows.flatMap((r) => [r.root, ...r.invitees]))];
  const profiles = allRoots.length
    ? await redis.mget<({ username?: string } | null)[]>(...allRoots.map((r) => `gd:profile:${r}`))
    : [];
  const nameOf = new Map<string, string | null>();
  allRoots.forEach((r, i) => nameOf.set(r, profiles[i]?.username ?? null));

  const participants: Participant[] = rows
    .map((r) => {
      const owed = owedWei(r.count, cfg);
      const outstanding = owed > r.paid ? owed - r.paid : 0n;
      return {
        root: r.root,
        username: nameOf.get(r.root) ?? null,
        referralCount: r.count,
        owedWei: owed.toString(),
        paidWei: r.paid.toString(),
        outstandingWei: outstanding.toString(),
        invitees: r.invitees.map((iv) => ({ root: iv, username: nameOf.get(iv) ?? null })),
      };
    })
    .sort((a, b) => b.referralCount - a.referralCount || (BigInt(b.owedWei) > BigInt(a.owedWei) ? 1 : -1));

  // Optional "you" block — the caller's own standing (resolved by identity root).
  let you: (Participant & { rank: number | null }) | null = null;
  const address = req.nextUrl.searchParams.get("address");
  if (address && ADDR_RE.test(address)) {
    const root = await resolveIdentityRoot(address.toLowerCase());
    const existing = participants.find((p) => p.root === root);
    if (existing) {
      you = { ...existing, rank: participants.findIndex((p) => p.root === root) + 1 };
    } else {
      // Not on the board yet (0 in-window referrals) — still report a zeroed block.
      you = {
        root, username: nameOf.get(root) ?? null, referralCount: 0,
        owedWei: "0", paidWei: "0", outstandingWei: "0", invitees: [], rank: null,
      };
    }
  }

  return NextResponse.json({
    ok: true,
    phase,
    config: {
      startsAt: cfg.startsAt,
      endsAt: cfg.endsAt,
      potWei: cfg.potWei,
      perReferralWei: cfg.perReferralWei,
      threshold: cfg.threshold,
    },
    potSpentWei: spent.toString(),
    participants,
    you,
  }, {
    // Served from Vercel's CDN for ~2 min (keyed by the full URL, incl. ?address),
    // so the every-60s polls mostly hit the edge instead of invoking a function.
    // The manual refresh button cache-busts for instant fresh data.
    headers: { "Cache-Control": "public, s-maxage=110, stale-while-revalidate=300" },
  });
}
