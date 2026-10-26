"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Copy, Check, Medal, Users, Target, MapPin, Coins, Flame } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { UserHandle } from "@/components/UserHandle";
import { useProfile } from "@/hooks/useProfile";
import { formatG$, shortAddr, RARITY, type DropRarity } from "@/lib/utils";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { MetaChip, StatPill, DrawerSection, RankMedal } from "./Pieces";
import { BadgeGrid } from "./BadgeGrid";
import type { HunterProfileData, WallBadge } from "./useHunterProfile";
import { useHunterStreak } from "./useHunterStreak";

// Map pulls in MapLibre — load it only if this profile actually has finds to show.
const HunterFindsMap = dynamic(
  () => import("@/components/HunterFindsMap").then((m) => m.HunterFindsMap),
  { ssr: false, loading: () => <Skeleton className="h-[220px] rounded-3xl" /> },
);

const RARITY_ORDER: DropRarity[] = ["legendary", "rare", "uncommon", "common"];

interface Props {
  address: string;
  rank?: number | null;
  data: HunterProfileData | null;
  badges: WallBadge[] | null;
  selectedBadgeId: string | null;
  onSelectBadge: (b: WallBadge) => void;
  /** Rendered by the shell so it can sit in the sheet's grab area. */
  header?: React.ReactNode;
}

/**
 * The profile body. Shared by the drawer and by /hunter/[address], so a deep
 * link and an in-app tap show exactly the same thing.
 *
 * Every async block owns its own skeleton: stats and badges arrive from separate
 * endpoints, and neither should hold up the other.
 */
export function ProfileContent({
  address, rank, data, badges, selectedBadgeId, onSelectBadge, header,
}: Props) {
  const profile = useProfile(address);
  const streak = useHunterStreak(address);
  const [copied, setCopied] = useState(false);
  const loading = data === null;

  const earnedCount = badges?.filter((b) => b.earned).length ?? 0;
  const coreTotal = badges?.length ?? 0;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the address is on screen anyway */ }
  }

  return (
    <>
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="border-b border-line">
        {header}
        <div className="flex justify-between gap-4 px-6 pb-6">
          <div className="min-w-0 flex-1">
            <div className="flex gap-x-4 mb-3 min-w-0">
              <Avatar
                address={address}
                username={profile?.username}
                preset={profile?.avatar}
                size={64}
                ringColor="transparent"
                className="shrink-0"
              />
              <div className="flex flex-col gap-y-2 min-w-0 justify-center">
                <UserHandle address={address} className="text-xl/none text-heading truncate" />
                <button
                  onClick={copyAddress}
                  title="Copy address"
                  className="group flex items-center gap-2 text-sm/none text-nav-muted min-w-0 cursor-pointer
                    motion-safe:transition-colors hover:text-heading"
                >
                  <span className="truncate">{shortAddr(address)}</span>
                  {copied
                    ? <Check className="w-4 h-4 shrink-0 text-brand" />
                    : <Copy className="w-4 h-4 shrink-0" />}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <MetaChip
                icon={<Medal className="w-[18px] h-[18px]" />}
                value={`${earnedCount}/${coreTotal}`}
                label="Core badges"
                loading={badges === null}
              />
              <MetaChip
                icon={<Users className="w-[18px] h-[18px]" />}
                value={String(data?.referralCount ?? 0)}
                label="Referred"
                loading={loading}
              />
              {/* Only once we know there IS a streak — a "0 day streak" chip is
                  discouraging, and the old profile hid it the same way. */}
              {streak !== undefined && streak !== null && streak.current > 0 && (
                <MetaChip
                  icon={<Flame className="w-[18px] h-[18px] text-streak" />}
                  value={String(streak.current)}
                  label={`day streak · best ${streak.best}`}
                  loading={false}
                />
              )}
            </div>
          </div>

          <RankMedal rank={rank} />
        </div>
      </div>

      {/* ── Core stats ───────────────────────────────────────────────────── */}
      <div className="pt-6 px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatPill
          icon={<Target className="w-5 h-5" />}
          value={String(data?.claims ?? 0)}
          label="Drops claimed"
          loading={loading}
        />
        <StatPill
          icon={<MapPin className="w-5 h-5" />}
          value={String(data?.created ?? 0)}
          label="Drops created"
          loading={loading}
        />
        <StatPill
          icon={<Coins className="w-5 h-5" />}
          value={data ? formatG$(BigInt(data.totalClaimedWei)) : "0"}
          label="G$ claimed"
          loading={loading}
        />
        <StatPill
          icon={<Coins className="w-5 h-5" />}
          value={data ? formatG$(BigInt(data.totalDroppedWei)) : "0"}
          label="G$ dropped"
          loading={loading}
        />
      </div>

      {/* ── Highlights — only meaningful once they've actually hunted ─────── */}
      {data && data.claims > 0 && (
        <DrawerSection title="Highlights">
          <div className="grid grid-cols-2 gap-3">
            <Highlight
              label="Biggest find"
              value={`${formatG$(BigInt(data.biggestWei))} G$`}
              sub={RARITY[rarityOf(data)].label}
              subColor={RARITY[rarityOf(data)].color}
            />
            <Highlight label="Average find" value={`${formatG$(BigInt(data.avgWei))} G$`} />
            <Highlight
              label="Net G$"
              value={netLabel(data)}
              sub={netPositive(data) ? "net earner" : "net giver"}
            />
            <Highlight
              label="Hunting since"
              value={
                data.firstHunt
                  ? new Date(data.firstHunt * 1000).toLocaleDateString("en", { month: "short", year: "numeric" })
                  : "—"
              }
            />
          </div>
        </DrawerSection>
      )}

      {/* ── Rarity breakdown ─────────────────────────────────────────────── */}
      {data && data.claims > 0 && (
        <DrawerSection title="Finds by rarity">
          <div className="flex flex-wrap gap-2">
            {RARITY_ORDER.filter((r) => data.rarityCounts[r] > 0).map((r) => (
              <div key={r} className="flex items-center gap-2 bg-surface rounded-full px-4 py-2.5">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: RARITY[r].color }} />
                <span className="text-sm/none text-heading">{RARITY[r].label}</span>
                <span className="text-sm/none text-nav-muted">×{data.rarityCounts[r]}</span>
              </div>
            ))}
          </div>
        </DrawerSection>
      )}

      {/* ── Where they've hunted ─────────────────────────────────────────── */}
      {data && data.finds.length > 0 && (
        <DrawerSection title="Where they've hunted">
          <div className="rounded-3xl overflow-hidden border border-line">
            <HunterFindsMap
              points={data.finds.map((f) => ({
                lat: f.lat,
                lng: f.lng,
                amount: formatG$(BigInt(f.amount)),
                color: f.color,
              }))}
            />
          </div>
        </DrawerSection>
      )}

      {/* ── Badges ───────────────────────────────────────────────────────── */}
      <DrawerSection title="Badges">
        <BadgeGrid badges={badges} selectedId={selectedBadgeId} onSelect={onSelectBadge} />
      </DrawerSection>

      {/* ── Recent claims ────────────────────────────────────────────────── */}
      {loading ? (
        <DrawerSection title="Recent claims">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
          </div>
        </DrawerSection>
      ) : data.recentClaims.length > 0 ? (
        <DrawerSection title="Recent claims">
          <div className="flex flex-col gap-2">
            {data.recentClaims.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border border-line rounded-full p-2 pr-5">
                {/* The same chest the map pins use, on a soft wash of the rarity
                    colour — a find should look like a find, not a lightning bolt. */}
                <span
                  className="w-11.5 h-11.5 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: `rgba(${RARITY[c.rarity].glowRgb},0.16)` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/treasure-chest-lg.png" alt="" width={32} height={32} className="w-8 h-8 object-contain select-none" draggable={false} />
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-y-1">
                  <span className="text-lg/none text-heading">{formatG$(BigInt(c.amount))} G$</span>
                  <span className="text-sm/none text-nav-muted truncate">
                    Drop #{c.id} ·{" "}
                    <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: RARITY[c.rarity].color }} />
                    {RARITY[c.rarity].label}
                  </span>
                </div>
                {c.claimedAt > 0 && (
                  <span className="text-sm/none text-nav-muted shrink-0">
                    {new Date(c.claimedAt * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </DrawerSection>
      ) : null}
    </>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function rarityOf(d: HunterProfileData): DropRarity {
  const big = BigInt(d.biggestWei);
  const n = Number(big) / 1e18;
  return n >= 200 ? "legendary" : n >= 50 ? "rare" : n >= 10 ? "uncommon" : "common";
}

function netPositive(d: HunterProfileData): boolean {
  return BigInt(d.totalClaimedWei) >= BigInt(d.totalDroppedWei);
}

function netLabel(d: HunterProfileData): string {
  const net = BigInt(d.totalClaimedWei) - BigInt(d.totalDroppedWei);
  const pos = net >= 0n;
  return `${pos ? "+" : "−"}${formatG$(pos ? net : -net)}`;
}

/** Small outlined cell used by the Highlights grid. */
function Highlight({
  label, value, sub, subColor,
}: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="border border-line rounded-3xl px-5 py-4 min-w-0">
      <p className="text-lg/none text-heading truncate">{value}</p>
      {sub && (
        <p className="text-sm/none mt-2 truncate" style={{ color: subColor ?? "#6B6E63" }}>{sub}</p>
      )}
      <p className="text-sm/none text-nav-muted mt-2 truncate">{label}</p>
    </div>
  );
}
