"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, Coins, Gift, Share2, Target, Users, Map as MapIcon, RefreshCw } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { RankBadge } from "@/app/leaderboard/components/RankBadge";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { useProfiles } from "@/hooks/useProfile";
import { shareOrCopy } from "@/lib/share";
import { shortAddr } from "@/lib/utils";
import type { PublicStats } from "./data";

const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A]";
const fmt = (n: number) => n.toLocaleString("en");
const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, "")}M`
  : n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`
  : fmt(n);

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m === 1 ? "a minute ago" : `${m} minutes ago`;
}

/**
 * The public, shareable numbers. Server-rendered for search and link previews,
 * then refreshed every minute while the tab is open.
 */
export function StatsClient({ initial }: { initial: PublicStats | null }) {
  const [s, setS] = useState<PublicStats | null>(initial);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/stats");
      if (!r.ok) throw new Error(String(r.status));
      setS(await r.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initial) load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => { window.clearInterval(t); window.clearInterval(tick); };
  }, [initial, load]);

  const addresses = useMemo(
    () => (s ? [...s.topHunters, ...s.topDroppers].map((r) => r.address) : []),
    [s],
  );
  const profiles = useProfiles(addresses);
  const name = (a: string) => (profiles[a.toLowerCase()]?.username ? `@${profiles[a.toLowerCase()]!.username}` : shortAddr(a));

  async function share() {
    const text = s
      ? `GoodDrops so far: ${fmt(s.drops)} drops hidden, ${compact(s.claimedG)} G$ found by ${fmt(s.hunters)} people.`
      : "GoodDrops in numbers";
    if ((await shareOrCopy({ title: "GoodDrops in numbers", text, url: `${window.location.origin}/stats` })) === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[32px]/none lg:text-4xl/none text-heading">GoodDrops in numbers</h1>
          <p className="text-sm/[140%] text-nav-muted mt-3 max-w-[560px]">
            Real G$ hidden at real places and found by face-verified people. Straight from the chain, updated every minute.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs/none text-nav-muted inline-flex items-center gap-1.5" aria-live="polite">
            {refreshing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <span className="w-2 h-2 rounded-full bg-brand" aria-hidden />}
            {s ? `Updated ${ago(s.at, now)}` : "Loading"}
          </span>
          <button
            type="button"
            onClick={share}
            className="h-11 px-5 rounded-full bg-nav-active text-white text-sm/none flex items-center gap-2 cursor-pointer motion-safe:transition-opacity hover:opacity-90"
          >
            {copied ? <><Check className="w-4 h-4" /> Link copied</> : <><Share2 className="w-4 h-4" /> Share</>}
          </button>
        </div>
      </div>

      {error && !s ? (
        <div className={`${CARD} p-8 flex flex-col items-center text-center gap-3`}>
          <p className="text-lg/none text-heading">Couldn&apos;t load the numbers</p>
          <p className="text-sm/[140%] text-nav-muted">Check your connection and try again.</p>
          <button type="button" onClick={load} className="h-11 px-6 rounded-full bg-brand text-white text-sm/none cursor-pointer hover:bg-brand/90">Try again</button>
        </div>
      ) : (
        <>
          {/* Headline: the one number that matters most, then the rest. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <div className="col-span-2 rounded-3xl bg-brand text-white p-6 lg:p-7 flex flex-col justify-between min-h-[168px]">
              <span className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center"><Coins className="w-5 h-5" /></span>
              <div>
                {s ? <p className="font-anta text-[44px]/none lg:text-[56px]/none">{fmt(s.claimedG)} <span className="text-[24px] lg:text-[28px] text-white/70">G$</span></p>
                  : <Skeleton className="h-12 w-56 bg-white/20" />}
                <p className="text-sm/none text-white/80 mt-3">G$ found and put into circulation</p>
              </div>
            </div>
            <Tile icon={<MapIcon className="w-5 h-5" />} value={s && fmt(s.drops)} label="Drops hidden" />
            <Tile icon={<Target className="w-5 h-5" />} value={s && fmt(s.claims)} label="Drops claimed" />
            <Tile icon={<Gift className="w-5 h-5" />} value={s && `${compact(s.droppedG)} G$`} label="G$ dropped" />
            <Tile icon={<Users className="w-5 h-5" />} value={s && fmt(s.hunters)} label="Hunters" sub="Unique people" />
            <Tile icon={<Users className="w-5 h-5" />} value={s && fmt(s.droppers)} label="Droppers" sub="Unique people" />
            <Tile icon={<Check className="w-5 h-5" />} value={s && (s.drops ? `${Math.round((s.claims / s.drops) * 100)}%` : "–")} label="Found rate" sub="Drops claimed before expiring" />
          </div>

          {/* Events */}
          {s?.events && (
            <Link href="/events" className={`${CARD} mt-4 p-5 lg:p-6 flex flex-col sm:flex-row sm:items-center gap-4 group`}>
              <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center"><CalendarDays className="w-5 h-5" /></span>
              <div className="flex-1 min-w-0">
                {s.events.hosted > 0 ? (
                  <>
                    <p className="text-lg/none text-heading">{fmt(s.events.hosted)} event{s.events.hosted === 1 ? "" : "s"} hosted · {fmt(s.events.claimedG)} G$ found at events</p>
                    <p className="text-sm/[140%] text-nav-muted mt-2">Meetups, concerts and campus days with G$ hidden around them.</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg/none text-heading">Events are here</p>
                    <p className="text-sm/[140%] text-nav-muted mt-2">Meetups, concerts and campus days with G$ hidden around them.</p>
                  </>
                )}
              </div>
              <span className="self-start sm:self-center h-11 px-5 rounded-full bg-surface text-sm/none text-heading flex items-center group-hover:bg-nav-controls motion-safe:transition-colors">See events</span>
            </Link>
          )}

          {/* Top 10s */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <Top title="Top hunters" unit="found" rows={s?.topHunters} name={name} countLabel="claims" />
            <Top title="Top droppers" unit="dropped" rows={s?.topDroppers} name={name} countLabel="drops" />
          </div>
          <p className="text-xs/[140%] text-nav-muted mt-4">
            People with several wallets linked to one GoodDollar identity count once. <Link href="/leaderboard" className="text-heading underline underline-offset-2">Full rankings</Link>
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ icon, value, label, sub }: { icon: React.ReactNode; value: string | null | undefined | false; label: string; sub?: string }) {
  return (
    <div className={`${CARD} p-5 lg:p-6 flex flex-col gap-4 min-w-0`}>
      <span className="w-10 h-10 rounded-full bg-surface text-heading flex items-center justify-center">{icon}</span>
      <div className="min-w-0">
        {value ? <p className="font-anta text-[26px]/none lg:text-[30px]/none text-heading truncate">{value}</p> : <Skeleton className="h-7 w-24" />}
        <p className="text-sm/none text-nav-muted mt-2.5 truncate">{label}</p>
        {sub && <p className="text-xs/none text-nav-muted/70 mt-1.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function Top({
  title, unit, rows, name, countLabel,
}: { title: string; unit: string; rows?: PublicStats["topHunters"]; name: (a: string) => string; countLabel: string }) {
  return (
    <section className={`${CARD} p-5 lg:p-6`}>
      <h2 className="text-xl/none text-heading mb-4">{title}</h2>
      <ol className="flex flex-col">
        {rows
          ? rows.map((r, i) => (
            <li key={r.address}>
              <Link href={`/hunter/${r.address}`} className="flex items-center gap-3 py-2.5 rounded-2xl -mx-2 px-2 hover:bg-surface motion-safe:transition-colors">
                <span className="w-11.5 flex justify-center shrink-0 [&_img]:!w-11.5 [&_img]:!h-11.5"><RankBadge rank={i + 1} /></span>
                <ProfileAvatar address={r.address} size={36} ringColor="transparent" />
                <span className="min-w-0 flex-1">
                  <span className="block text-base/none text-heading truncate">{name(r.address)}</span>
                  <span className="block text-xs/none text-nav-muted mt-1.5">{fmt(r.count)} {countLabel}</span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-base/none text-heading">{compact(r.g)}</span>
                  <span className="block text-xs/none text-nav-muted mt-1.5">G$ {unit}</span>
                </span>
              </Link>
            </li>
          ))
          : Array.from({ length: 6 }, (_, i) => <li key={i} className="py-2.5"><Skeleton className="h-11 w-full" /></li>)}
      </ol>
    </section>
  );
}
