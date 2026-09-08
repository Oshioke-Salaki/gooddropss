"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  Users, Trophy, Gift, ChevronDown, ChevronUp, ArrowUpRight, RefreshCw,
  Star, UserPlus, Coins, MapPin, Target, Network, HelpCircle,
} from "lucide-react";
import clsx from "clsx";
import {
  fmtG, fmtScore, nameOrShort, rankBg, useNow, usePoll,
  Countdown, HowStep, StatCard, InviteLink, type Phase,
} from "./shared";

interface ClaimerRef { root: string; username: string | null; referred: boolean; gG: number }
interface Participant {
  root: string; username: string | null;
  reach: number; claims: number; refs: number; depth: number; downline: number; base: number;
  score: number; dropsClaimed: number; gDropped: number;
  rank: number; prizeG: number; claimers: ClaimerRef[];
}
interface Stats { gCirculated: number; drops: number; claims: number; referredUsers: number }
interface Data {
  ok: boolean;
  phase: Phase;
  stats: Stats;
  config: { startsAt: number; endsAt: number; potWei: string; tiers: number[]; minDropWei: string | null; downlineWeights: number[] | null; referralBonusWeight: number | null };
  participants: Participant[];
  you: (Participant & { rank: number | null }) | null;
}

// The POINTS competition: drop + claim + refer + downline network bonus, top-N
// split the pot. Only mounted while its tab is selected, so switching tabs never
// pays for the other board's computation.
export function PointsBoard({ address, myLink }: { address?: string; myLink: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const load = useCallback((force = false) => {
    const p = new URLSearchParams();
    if (address) p.set("address", address);
    if (force) p.set("_", String(Date.now()));
    const q = p.toString() ? `?${p}` : "";
    return fetch(`/api/comp/leaderboard${q}`, force ? { cache: "reload" } : undefined)
      .then((r) => r.json()).then(setData).catch(() => {});
  }, [address]);
  useEffect(() => { load(); }, [load]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    await Promise.all([load(true), new Promise((r) => setTimeout(r, 500))]);
    setRefreshing(false);
  }

  const now = useNow();
  const cfg = data?.config;
  const phase: Phase = data?.phase ?? "upcoming";
  usePoll(load, !cfg || now < cfg.endsAt + 300);

  const target = cfg ? (now < cfg.startsAt ? cfg.startsAt : cfg.endsAt) : 0;
  const potWei = cfg?.potWei ?? "0";
  const tiers = cfg?.tiers ?? [];
  const winners = tiers.length;
  const minDropG = cfg?.minDropWei ? Math.round(Number(cfg.minDropWei) / 1e18) : 0;
  const dw = cfg?.downlineWeights ?? [0.25, 0.1];
  const l1Pct = Math.round((dw[0] ?? 0) * 100), l2Pct = Math.round((dw[1] ?? 0) * 100);
  const refWeight = cfg?.referralBonusWeight ?? 1;
  const refPts = `${refWeight} point${refWeight === 1 ? "" : "s"}`;
  const stats = data?.stats;
  const you = data?.you ?? null;
  const participants = data?.participants ?? [];

  return (
    <>
      {/* Hero */}
      <div className="bg-ink text-cream border-2 border-ink rounded-2xl p-5 shadow-brutal mb-4 text-center">
        <div className="inline-flex items-center gap-1.5 bg-lime text-ink font-black text-xs px-3 py-1 rounded-full mb-3">
          <Trophy size={13} /> POINTS COMPETITION
        </div>
        <p className="font-black text-4xl leading-none">{fmtG(potWei)} <span className="text-lime">G$</span></p>
        <p className="text-sm text-cream/70 mt-2 leading-relaxed">
          Move real G$ to real people. Earn points three ways — <span className="text-lime font-bold">drop</span>,
          <span className="text-lime font-bold"> claim</span>, and <span className="text-lime font-bold">refer</span> —
          plus a bonus from everyone you bring in. The <span className="text-lime font-bold">top {winners}</span> share the pot.
        </p>
        <Countdown phase={phase} target={target} now={now} />
      </div>

      {/* Live stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <StatCard icon={<Coins size={18} />} value={stats.gCirculated.toLocaleString()} label="G$ circulated" />
          <StatCard icon={<MapPin size={18} />} value={stats.drops.toLocaleString()} label="Drops" />
          <StatCard icon={<Target size={18} />} value={stats.claims.toLocaleString()} label="Claims" />
          <StatCard icon={<UserPlus size={18} />} value={stats.referredUsers.toLocaleString()} label="Referred" />
        </div>
      )}

      {/* How to play — collapsible to keep the page short */}
      {cfg && (
        <div className="bg-card border-2 border-ink rounded-2xl shadow-brutal-sm mb-4 overflow-hidden">
          <button onClick={() => setHowOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-cream transition-colors">
            <HelpCircle size={18} className="shrink-0" />
            <span className="font-black text-base flex-1">How to play &amp; prizes</span>
            {howOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {howOpen && (
            <div className="px-4 pb-4 pt-0 border-t-2 border-ink/10">
              <p className="text-sm font-bold mt-3 mb-2">Earn points 4 ways — your score is the total:</p>
              <ol className="space-y-2.5">
                <HowStep n={1}><span className="font-bold text-ink">Drop</span> G$ around town{minDropG > 0 ? <> (at least <span className="font-bold text-ink">{minDropG.toLocaleString()} G$</span> a drop)</> : ""} and get people to claim it. Each <span className="font-bold text-ink">different person</span> who claims your drop = <span className="font-bold text-ink">1 point</span>.</HowStep>
                <HowStep n={2}><span className="font-bold text-ink">Claim</span> other people&apos;s drops too. Each <span className="font-bold text-ink">different person</span> whose drop you claim = <span className="font-bold text-ink">1 point</span>.</HowStep>
                <HowStep n={3}><span className="font-bold text-ink">Refer</span> new people with your link. Each friend who joins, verifies, and plays = <span className="font-bold text-ink">{refPts}</span>.</HowStep>
                <HowStep n={4}><span className="font-bold text-ink">Grow a team.</span> You also earn <span className="font-bold text-ink">{l1Pct}%</span> of the points your referrals score, and <span className="font-bold text-ink">{l2Pct}%</span> of the points <span className="italic">their</span> referrals score. Build an active network and it lifts your score too.</HowStep>
              </ol>
              <p className="mt-3 text-xs text-muted leading-relaxed">
                Each person counts once for a drop and once for a claim, so the way to climb is to reach and claim with as many <span className="font-semibold text-ink">different</span> people as you can. Both sides of every drop must be GoodDollar-verified.
              </p>
              {tiers.length > 0 && (
                <>
                  <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted mt-4 mb-2">Prizes · top {winners}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tiers.map((g, i) => (
                      <span key={i} className={clsx("inline-flex items-center gap-1 border-2 border-ink rounded-full px-2.5 py-1 text-xs font-black", rankBg(i + 1))}>
                        #{i + 1} · {g.toLocaleString()} G$
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Your invite link + position */}
      {address ? (
        <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm mb-5">
          <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-2">Your invite link</p>
          <InviteLink myLink={myLink} />
          {you && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-bold">{you.rank ? `You're #${you.rank}` : "Not on the board yet"}</span>
              <span className="text-muted">
                {fmtScore(you.score)} pt{you.score === 1 ? "" : "s"} · {you.reach} reached · {you.claims} claimed
                {you.refs > 0 ? ` · ${you.refs} referred` : ""}{you.depth > 0 ? ` · +${fmtScore(you.depth)} network` : ""}
              </span>
              {you.prizeG > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-black text-ink bg-lime border border-ink rounded-full px-2 py-0.5">
                  <Gift size={12} /> in the money: {you.prizeG.toLocaleString()} G$
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm mb-5 text-sm text-muted">
          Sign in to get your invite link and join the competition.
        </div>
      )}

      {/* Leaderboard */}
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={18} />
        <p className="font-black text-lg">Leaderboard</p>
        <button onClick={refresh} disabled={refreshing} aria-label="Refresh leaderboard" title="Refresh"
          className="ml-auto w-9 h-9 rounded-full border-2 border-ink bg-card shadow-brutal-sm flex items-center justify-center hover:bg-lime active:translate-y-px transition-colors disabled:opacity-60">
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {!data ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 bg-border rounded-2xl animate-pulse" />)}</div>
      ) : participants.length === 0 ? (
        <div className="text-center py-14 space-y-2">
          <Users size={40} className="mx-auto text-muted" strokeWidth={1.5} />
          <p className="font-bold">Nobody on the board yet</p>
          <p className="text-sm text-muted">{phase === "live" ? "Drop G$ for people, claim other drops, and refer friends to get on the board." : "The competition hasn't started."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {participants.map((p) => {
            const isMe = !!you && you.root === p.root;
            const top3 = p.rank <= 3;
            const open = expanded === p.root;
            return (
              <div key={p.root} className={clsx("border-2 border-ink rounded-2xl min-w-0", isMe ? "bg-lime shadow-brutal" : "bg-card shadow-brutal-sm")}>
                <div className="flex items-center gap-3 px-3 py-3">
                  <div className={clsx("w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-black shrink-0", rankBg(p.rank))}>{p.rank}</div>
                  <ProfileAvatar address={p.root} size={34} ringColor={top3 ? "#111" : "#d6d5cf"} />
                  <Link href={`/hunter/${p.root}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm truncate max-w-36">{nameOrShort(p.username, p.root)}</span>
                      {p.refs > 0 && (
                        <span title={`Referred ${p.refs} ${p.refs === 1 ? "person" : "people"}`}
                          className="inline-flex items-center gap-0.5 shrink-0 border border-ink rounded-full px-1.5 py-px text-[10px] font-black bg-cream">
                          <UserPlus size={10} /> {p.refs}
                        </span>
                      )}
                      {p.depth > 0 && (
                        <span title={`+${fmtScore(p.depth)} network bonus from ${p.downline} downline`}
                          className="inline-flex items-center gap-0.5 shrink-0 border border-ink rounded-full px-1.5 py-px text-[10px] font-black bg-cream">
                          <Network size={10} /> +{fmtScore(p.depth)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs opacity-70 font-medium truncate">
                      {p.reach} reached · {p.claims} claimed · {p.gDropped.toLocaleString()} G$ moved
                    </div>
                  </Link>
                  <div className="text-right shrink-0">
                    <div className="font-black text-xl leading-none tabular-nums">{fmtScore(p.score)}</div>
                    <div className="text-[11px] opacity-70 font-semibold uppercase tracking-wide">points</div>
                  </div>
                  <button onClick={() => setExpanded(open ? null : p.root)} aria-label={open ? "Hide" : "Show details"}
                    className="w-8 h-8 rounded-lg border-2 border-ink flex items-center justify-center shrink-0 bg-cream">
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {open && (
                  <div className="px-3 pb-3 pt-0 space-y-2">
                    <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                      <span className="border border-ink rounded-full px-2 py-0.5 bg-cream">{p.reach} drop pts</span>
                      <span className="border border-ink rounded-full px-2 py-0.5 bg-cream">{p.claims} claim pts</span>
                      <span className="border border-ink rounded-full px-2 py-0.5 bg-cream">{p.refs} referral pts</span>
                      {p.depth > 0 && <span className="border border-ink rounded-full px-2 py-0.5 bg-cream">+{fmtScore(p.depth)} network ({p.downline})</span>}
                      {p.prizeG > 0 && <span className="border border-ink rounded-full px-2 py-0.5 bg-lime">in the money: {p.prizeG.toLocaleString()} G$</span>}
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-1.5">Claimed your drops ({p.claimers.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {p.claimers.map((c) => (
                          <Link key={c.root} href={`/hunter/${c.root}`}
                            className={clsx("inline-flex items-center gap-1 border-2 border-ink rounded-full pl-2 pr-2.5 py-1 text-xs font-bold transition-colors",
                              c.referred ? "bg-lime hover:bg-lime/80" : "bg-cream hover:bg-lime")}
                            title={c.referred ? "You referred this person" : undefined}>
                            <ProfileAvatar address={c.root} size={16} ringColor="#111" />
                            {nameOrShort(c.username, c.root)}
                            {c.referred && <Star size={11} className="fill-ink" />}
                            <ArrowUpRight size={11} className="opacity-60" />
                          </Link>
                        ))}
                        {p.claimers.length === 0 && <span className="text-xs text-muted">No claims on your drops yet.</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-muted leading-relaxed">
        Your score adds up your own drops, claims and referrals, plus a network bonus from the people you bring in.
        Every person counts once per action and everyone must be GoodDollar-verified, so the more
        <span className="font-semibold text-ink"> different</span> real people you reach, the higher you climb.
        Prizes for the top {winners} are paid to your wallet when the competition ends.
      </p>
    </>
  );
}
