import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { fetchHunterProfile } from "@/lib/subgraph";
import { getUsername, getUserAvatar } from "@/lib/serverProfile";
import { EditAvatarButton } from "@/components/EditAvatarButton";
import { UserHandle } from "@/components/UserHandle";
import { HunterStreakBadge } from "@/components/HunterStreakBadge";
import { HunterRank } from "@/components/HunterRank";
import { ShareableHunterCard } from "@/components/ShareableHunterCard";
import { OwnProfileInvite } from "@/components/OwnProfileInvite";
import { BadgeWall } from "@/components/BadgeWall";
import { Avatar } from "@/components/Avatar";
import { formatG$, shortAddr, getDropRarity, RARITY, gpsToDeg, type DropRarity } from "@/lib/utils";
import { HunterFindsMap, type FindPoint } from "@/components/HunterFindsMap";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { type Drop } from "@/types";
import { ArrowLeft, Target, Coins, Zap, Star, Crown, Shield, Award, Users } from "lucide-react";

interface PageProps { params: Promise<{ address: string }> }

// Identity-scoped profile aggregates all drops (fetchAllDrops) + a root multicall
// — expensive to recompute. A profile barely changes minute to minute, so cache
// the rendered page for 5 min: fewer regenerations = much less Active CPU, and
// crawlers hitting many hunter URLs no longer each trigger a full re-scan.
export const revalidate = 300;

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { address } = await params;
  const username = await getUsername(address);
  const name = username ? `@${username}` : shortAddr(address);
  const canonical = `/hunter/${address.toLowerCase()}`;
  return {
    title: `${name} — Hunter`,
    description: `See ${name}'s GoodDrops stats, achievements and claim history — real G$ found in the wild.`,
    alternates: { canonical },
    openGraph: {
      title: `${name} — GoodDrops Hunter`,
      description: `${name}'s GoodDrops stats, achievements and claim history.`,
      url: canonical,
      type: "profile",
    },
  };
}

// ── Achievements ──────────────────────────────────────────────────────────────

interface Achievement {
  id: string;
  name: string;
  desc: string;
  Icon: React.ElementType;
  color: string;
  earned: boolean;
}

function computeAchievements(created: Drop[], claimed: Drop[]): Achievement[] {
  const fastClaim = claimed.some(
    (d) => d.claimedAt > 0 && (d.claimedAt - d.expiry + 30 * 24 * 3600) < 300
  );
  const whale     = created.some((d) => Number(d.amount) / 1e18 >= 200);
  const legendary = claimed.some((d) => getDropRarity(d.amount) === "legendary");

  return [
    { id: "first_hunt", name: "First Hunt",   desc: "Claimed your first drop",         Icon: Target, color: "#00CFFF", earned: claimed.length > 0 },
    { id: "first_drop", name: "Drop Maker",   desc: "Created your first drop",          Icon: Coins,  color: "#BFFD00", earned: created.length > 0 },
    { id: "speed",      name: "Speed Demon",  desc: "Claimed within 5 min of creation", Icon: Zap,    color: "#FFB800", earned: fastClaim },
    { id: "whale",      name: "Whale",        desc: "Dropped 200+ G$ in one go",        Icon: Star,   color: "#FF6B6B", earned: whale },
    { id: "legendary",  name: "Legend",       desc: "Claimed a Legendary drop",         Icon: Crown,  color: "#FFB800", earned: legendary },
    { id: "collector",  name: "Collector",    desc: "Claimed 5 or more drops",          Icon: Shield, color: "#00CFFF", earned: claimed.length >= 5 },
    { id: "pioneer",    name: "Pioneer",      desc: "Created 10+ drops",                Icon: Award,  color: "#BFFD00", earned: created.length >= 10 },
  ];
}


// People this identity has referred (identity-root scoped, Sybil-proof). Read
// straight from Redis since this is a server component.
async function getReferralCount(address: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const root = await resolveIdentityRoot(address);
    return (await redis.scard(keys.referralsOf(root))) ?? 0;
  } catch { return 0; }
}

// ── Page ──────────────────────────────────────────────────────────────────────

const RARITY_ORDER: DropRarity[] = ["legendary", "rare", "uncommon", "common"];

export default async function HunterPage({ params }: PageProps) {
  const { address } = await params;
  const [profile, username, avatarPreset, referralCount] = await Promise.all([
    fetchHunterProfile(address),
    getUsername(address),
    getUserAvatar(address),
    getReferralCount(address),
  ]);
  if (!profile) notFound();

  const { dropsCreated, dropsClaimed } = profile;
  const totalDropped = dropsCreated.reduce((s, d) => s + d.amount, 0n);
  const totalClaimed = dropsClaimed.reduce((s, d) => s + d.amount, 0n);

  // Richer stats
  const netWei    = totalClaimed - totalDropped;
  const netPos    = netWei >= 0n;
  const biggest   = dropsClaimed.reduce((m, d) => (d.amount > m ? d.amount : m), 0n);
  const avgWei    = dropsClaimed.length ? totalClaimed / BigInt(dropsClaimed.length) : 0n;
  const firstHunt = dropsClaimed.reduce(
    (min, d) => (d.claimedAt > 0 && (min === 0 || d.claimedAt < min) ? d.claimedAt : min),
    0,
  );
  const rarityCounts = { common: 0, uncommon: 0, rare: 0, legendary: 0 } as Record<DropRarity, number>;
  for (const d of dropsClaimed) rarityCounts[getDropRarity(d.amount)]++;

  // Map of public finds — private drops are stored on-chain as (0,0), so drop them.
  const findPoints: FindPoint[] = dropsClaimed
    .filter((d) => !(d.lat === 0 && d.lng === 0))
    .map((d) => ({
      lat: gpsToDeg(d.lat),
      lng: gpsToDeg(d.lng),
      amount: formatG$(d.amount),
      color: RARITY[getDropRarity(d.amount)].color,
    }))
    .filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0));

  const achievements = computeAchievements(dropsCreated, dropsClaimed);
  const earned = achievements.filter((a) => a.earned);
  // Hunter rank tier drives the avatar ring + badge — status that visibly levels up.
  const claimsN = dropsClaimed.length;
  const tier =
    claimsN >= 50 ? { ring: "#FFD700", badge: "👑" } :
    claimsN >= 10 ? { ring: "#BFFD00", badge: "🔥" } :
    claimsN >= 1  ? { ring: "#00CFFF", badge: "🌟" } :
                    { ring: "#111",    badge: null as string | null };

  return (
    <div className="min-h-[100dvh] bg-cream text-ink pb-16" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-cream/95 backdrop-blur border-b-2 border-ink">
        <div className="max-w-[480px] md:max-w-2xl lg:max-w-4xl mx-auto flex items-center gap-3 px-4 h-14">
          <Link
            href="/leaderboard"
            className="w-9 h-9 flex items-center justify-center bg-card border-2 border-ink rounded-xl shadow-brutal-sm hover:opacity-90"
            aria-label="Back to rankings"
          >
            <ArrowLeft size={18} />
          </Link>
          <Link href="/" className="font-black text-lg tracking-tight">
            good<span className="bg-ink text-lime px-1.5 py-0.5 rounded-md ml-0.5">drops.</span>
          </Link>
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-2xl lg:max-w-4xl mx-auto px-4">

        {/* Identity */}
        <div className="flex flex-col items-center text-center pt-9 pb-7 gap-3">
          <div className="shadow-brutal rounded-full relative">
            <Avatar address={address} username={username} preset={avatarPreset} size={92} ringColor={tier.ring} badge={tier.badge} />
            <EditAvatarButton address={address} />
          </div>
          <div>
            <UserHandle address={address} className="block font-black text-2xl leading-tight" />
            <p className="mt-1 text-xs font-mono text-muted break-all px-4">{address.toLowerCase()}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="bg-lime border-2 border-ink rounded-full px-3.5 py-1 text-xs font-black shadow-brutal-sm">
              🏆 {earned.length} / {achievements.length} core badges
            </div>
            <HunterStreakBadge address={address} />
            <div className="flex items-center gap-1.5 bg-card border-2 border-ink rounded-full px-3.5 py-1 text-xs font-black shadow-brutal-sm">
              <Users size={13} /> {referralCount} referred
            </div>
          </div>
        </div>

        {/* Core stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <Stat label="Drops Claimed" value={String(dropsClaimed.length)} />
          <Stat label="Drops Created" value={String(dropsCreated.length)} />
          <Stat label="G$ Claimed" value={formatG$(totalClaimed)} accent />
          <Stat label="G$ Dropped" value={formatG$(totalDropped)} />
        </div>

        {/* Global rank — pops in client-side once the subgraph responds */}
        {dropsClaimed.length > 0 && (
          <div className="mt-2.5">
            <HunterRank address={address} />
          </div>
        )}

        {/* Highlights */}
        {dropsClaimed.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-2.5">
            <Stat
              label="Biggest Find"
              value={`${formatG$(biggest)} G$`}
              sub={RARITY[getDropRarity(biggest)].label}
              subColor={RARITY[getDropRarity(biggest)].color}
            />
            <Stat
              label="Net G$"
              value={`${netPos ? "+" : "−"}${formatG$(netPos ? netWei : -netWei)}`}
              sub={netPos ? "net earner" : "net giver"}
            />
            <Stat label="Avg Find" value={`${formatG$(avgWei)} G$`} />
            <Stat
              label="Hunting Since"
              value={firstHunt ? new Date(firstHunt * 1000).toLocaleDateString("en", { month: "short", year: "numeric" }) : "—"}
            />
          </div>
        )}

        {/* Invite friends — own profile only. Density is the growth engine. */}
        <div className="mt-3 md:max-w-xl md:mx-auto">
          <OwnProfileInvite profileAddress={address} />
        </div>

        {/* Rarity breakdown */}
        {dropsClaimed.length > 0 && (
          <Section title="Finds by rarity">
            <div className="flex flex-wrap gap-2">
              {RARITY_ORDER.filter((r) => rarityCounts[r] > 0).map((r) => (
                <div
                  key={r}
                  className="flex items-center gap-2 bg-card border-2 border-ink rounded-full pl-2.5 pr-3 py-1.5 shadow-brutal-sm"
                >
                  <span className="w-3 h-3 rounded-full border border-ink" style={{ background: RARITY[r].color }} />
                  <span className="text-xs font-bold">{RARITY[r].label}</span>
                  <span className="text-xs font-black tabular-nums">×{rarityCounts[r]}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Map of finds */}
        {findPoints.length > 0 && (
          <Section title="Where they've hunted">
            <HunterFindsMap points={findPoints} />
          </Section>
        )}

        {/* Badges — presence-verified status. Replaces the old achievements grid
            (builtin badges mirror those one-for-one, so nobody loses status);
            fetching the wall also lazily awards anything newly eligible. */}
        <Section title="Badges">
          <BadgeWall address={address} />
        </Section>

        {/* Recent claims */}
        {dropsClaimed.length > 0 && (
          <Section title="Recent Claims">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {dropsClaimed.slice(0, 6).map((d) => {
                const r = RARITY[getDropRarity(d.amount)];
                return (
                  <div key={String(d.id)} className="flex items-center gap-3 bg-card border-2 border-ink rounded-xl p-3 shadow-brutal-sm">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border-2 border-ink"
                      style={{ background: r.color }}
                    >
                      <Target size={17} color="#111" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black leading-none">{formatG$(d.amount)} G$</p>
                      <p className="text-[11px] text-muted mt-1">Drop #{String(d.id)} · {r.label}</p>
                    </div>
                    {d.claimedAt > 0 && (
                      <p className="text-[11px] font-semibold text-muted shrink-0">
                        {new Date(d.claimedAt * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Shareable hunter card */}
        <Section title="Show off your hunts">
          <div className="md:max-w-xl md:mx-auto">
          <ShareableHunterCard
            handle={username ? `@${username}` : shortAddr(address)}
            gClaimed={formatG$(totalClaimed)}
            claims={dropsClaimed.length}
            achievements={earned.length}
            totalAch={achievements.length}
          />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────────

function Stat({
  label, value, accent, sub, subColor,
}: {
  label: string;
  value: string;
  accent?: boolean;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div className={clsx(
      "border-2 border-ink rounded-2xl p-4 text-center shadow-brutal",
      accent ? "bg-lime" : "bg-card",
    )}>
      <p className="text-2xl font-black leading-none truncate">{value}</p>
      {sub && (
        <p className="text-[10px] font-black uppercase tracking-wide mt-1" style={{ color: subColor ?? "#5a5a5a" }}>
          {sub}
        </p>
      )}
      <p className={clsx("text-[11px] font-bold uppercase tracking-wide mt-1.5", accent ? "text-ink/70" : "text-muted")}>
        {label}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <p className="text-[11px] font-black uppercase tracking-[0.1em] text-muted mb-3">{title}</p>
      {children}
    </div>
  );
}
