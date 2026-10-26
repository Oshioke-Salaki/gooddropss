import { NextRequest, NextResponse } from "next/server";
import { fetchHunterProfile } from "@/lib/subgraph";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { getDropRarity, gpsToDeg, RARITY, type DropRarity } from "@/lib/utils";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * People this identity has referred — identity-root scoped, so Sybil-proof.
 * Also a few of their addresses, so the profile's invite banner can show real
 * faces rather than placeholders. Roots are wallets, so they render as avatars.
 */
async function getReferrals(address: string): Promise<{ count: number; sample: string[] }> {
  const redis = getRedis();
  if (!redis) return { count: 0, sample: [] };
  try {
    const root = await resolveIdentityRoot(address);
    const [count, sample] = await Promise.all([
      redis.scard(keys.referralsOf(root)),
      redis.srandmember<string[]>(keys.referralsOf(root), 3),
    ]);
    return {
      count: count ?? 0,
      sample: (Array.isArray(sample) ? sample : []).filter((a) => ADDR_RE.test(String(a))),
    };
  } catch {
    return { count: 0, sample: [] };
  }
}

/**
 * GET /api/hunter?address=0x…
 *
 * Everything the profile drawer shows, in one round-trip. The drawer is opened
 * from a click (leaderboard row, wallet modal), so it can't be server-rendered
 * the way /hunter/[address] is — and firing the subgraph, the identity multicall
 * and Redis separately from the browser would be three waterfalls.
 *
 * Identity-scoped: stats aggregate every wallet linked to the same GoodDollar
 * root, matching the leaderboard exactly.
 *
 * Wei values are strings — JSON has no bigint.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!address || !ADDR_RE.test(address)) {
    return NextResponse.json({ error: "valid address required" }, { status: 400 });
  }

  const [profile, referrals] = await Promise.all([
    fetchHunterProfile(address),
    getReferrals(address),
  ]);

  if (!profile) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { dropsCreated, dropsClaimed } = profile;
  const totalDropped = dropsCreated.reduce((s, d) => s + d.amount, 0n);
  const totalClaimed = dropsClaimed.reduce((s, d) => s + d.amount, 0n);
  const biggest = dropsClaimed.reduce((m, d) => (d.amount > m ? d.amount : m), 0n);
  const avgWei = dropsClaimed.length ? totalClaimed / BigInt(dropsClaimed.length) : 0n;
  const firstHunt = dropsClaimed.reduce(
    (min, d) => (d.claimedAt > 0 && (min === 0 || d.claimedAt < min) ? d.claimedAt : min),
    0,
  );

  const rarityCounts = { common: 0, uncommon: 0, rare: 0, legendary: 0 } as Record<DropRarity, number>;
  for (const d of dropsClaimed) rarityCounts[getDropRarity(d.amount)]++;

  // Private drops are stored on-chain at (0,0), so they'd all pile up off the
  // coast of Africa — drop them rather than map a lie.
  const finds = dropsClaimed
    .filter((d) => !(d.lat === 0 && d.lng === 0))
    .map((d) => ({
      lat: gpsToDeg(d.lat),
      lng: gpsToDeg(d.lng),
      amount: d.amount.toString(),
      color: RARITY[getDropRarity(d.amount)].color,
    }))
    .filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0));

  const recentClaims = [...dropsClaimed]
    .sort((a, b) => (b.claimedAt || 0) - (a.claimedAt || 0))
    .slice(0, 6)
    .map((d) => ({
      id: String(d.id),
      amount: d.amount.toString(),
      claimedAt: d.claimedAt,
      rarity: getDropRarity(d.amount),
    }));

  return NextResponse.json(
    {
      address,
      claims: dropsClaimed.length,
      created: dropsCreated.length,
      totalClaimedWei: totalClaimed.toString(),
      totalDroppedWei: totalDropped.toString(),
      biggestWei: biggest.toString(),
      avgWei: avgWei.toString(),
      firstHunt,
      referralCount: referrals.count,
      referredSample: referrals.sample,
      rarityCounts,
      finds,
      recentClaims,
    },
    {
      // A profile barely moves minute to minute, and the underlying subgraph
      // fetch is the expensive bit. Same policy as the other read endpoints.
      headers: { "Cache-Control": "public, s-maxage=110, stale-while-revalidate=300" },
    },
  );
}
