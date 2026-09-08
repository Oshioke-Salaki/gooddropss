"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  Users, UserPlus, Coins, ChevronDown, ChevronUp, ArrowUpRight, RefreshCw,
  HelpCircle, Lock, Check, Wallet,
} from "lucide-react";
import clsx from "clsx";
import {
  fmtG, nameOrShort, rankBg, useNow, usePoll,
  Countdown, HowStep, StatCard, InviteLink, type Phase,
} from "./shared";

interface InviteeRef { root: string; username: string | null; at: number; covered: boolean }
interface Participant {
  root: string; username: string | null;
  count: number; covered: number; unlocked: boolean; earnedWei: string;
  rank: number; invitees: InviteeRef[];
}
interface Stats {
  referrals: number; qualifiedReferrers: number;
  slots: number; slotsUsed: number; paidOutWei: string; potWei: string;
}
interface Data {
  ok: boolean;
  phase: Phase;
  stats: Stats;
  config: { startsAt: number; endsAt: number; potWei: string; perReferralWei: string; threshold: number };
  participants: Participant[];
  you: (Participant & { rank: number | null }) | null;
}

// The REFERRAL competition: a flat rate per qualifying referral, unlocked at a
// threshold, paid first-come-first-served until the pot is exhausted.
export function ReferralBoard({ address, myLink }: { address?: string; myLink: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const load = useCallback((force = false) => {
    const p = new URLSearchParams();
    if (address) p.set("address", address);
    if (force) p.set("_", String(Date.now()));
    const q = p.toString() ? `?${p}` : "";
    return fetch(`/api/comp/referrals${q}`, force ? { cache: "reload" } : undefined)
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
  const perRefG = cfg ? Math.round(Number(cfg.perReferralWei) / 1e18) : 0;
  const threshold = cfg?.threshold ?? 5;
  const stats = data?.stats;
  const you = data?.you ?? null;
  const participants = data?.participants ?? [];
  const slotsLeft = stats ? Math.max(0, stats.slots - stats.slotsUsed) : 0;
  const potGone = !!stats && slotsLeft === 0 && stats.slots > 0;

  return (
    <>
      {/* Hero */}
      <div className="bg-ink text-cream border-2 border-ink rounded-2xl p-5 shadow-brutal mb-4 text-center">
        <div className="inline-flex items-center gap-1.5 bg-lime text-ink font-black text-xs px-3 py-1 rounded-full mb-3">
          <UserPlus size={13} /> REFERRAL COMPETITION
        </div>
        <p className="font-black text-4xl leading-none">{fmtG(potWei)} <span className="text-lime">G$</span></p>
        <p className="text-sm text-cream/70 mt-2 leading-relaxed">
          Earn <span className="text-lime font-bold">{perRefG.toLocaleString()} G$</span> for every friend you bring who
          verifies and plays. Unlock your earnings at <span className="text-lime font-bold">{threshold} referrals</span> —
          then it&apos;s paid first come, first served until the pot runs out.
        </p>
        <Countdown phase={phase} target={target} now={now} />
      </div>

      {/* Live stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <StatCard icon={<UserPlus size={18} />} value={stats.referrals.toLocaleString()} label="Referrals" />
          <StatCard icon={<Users size={18} />} value={stats.qualifiedReferrers.toLocaleString()} label="Unlocked" />
          <StatCard icon={<Coins size={18} />} value={fmtG(stats.paidOutWei)} label="G$ earned" />
          <StatCard icon={<Wallet size={18} />} value={slotsLeft.toLocaleString()} label="Slots left" />
        </div>
      )}

      {/* Pot exhausted banner */}
      {potGone && (
        <div className="border-2 border-ink rounded-2xl p-3 mb-4 bg-lime text-sm font-bold text-center shadow-brutal-sm">
          The {fmtG(potWei)} G$ referral pot has been fully claimed. Referrals after this point no longer earn.
        </div>
      )}

      {/* How it works */}
      {cfg && (
        <div className="bg-card border-2 border-ink rounded-2xl shadow-brutal-sm mb-4 overflow-hidden">
          <button onClick={() => setHowOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-cream transition-colors">
            <HelpCircle size={18} className="shrink-0" />
            <span className="font-black text-base flex-1">How it works</span>
            {howOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {howOpen && (
            <div className="px-4 pb-4 pt-0 border-t-2 border-ink/10">
              <ol className="space-y-2.5 mt-3">
                <HowStep n={1}>Share your invite link. Your friend joins through it, verifies with GoodDollar (one face scan), and does a task — claims or creates a drop.</HowStep>
                <HowStep n={2}>That counts as <span className="font-bold text-ink">1 referral</span>, worth <span className="font-bold text-ink">{perRefG.toLocaleString()} G$</span>.</HowStep>
                <HowStep n={3}>Reach <span className="font-bold text-ink">{threshold} referrals</span> to <span className="font-bold text-ink">unlock</span> your earnings. Below {threshold} you earn nothing, so push to {threshold} first.</HowStep>
                <HowStep n={4}>The pot pays <span className="font-bold text-ink">first come, first served</span> — earlier referrals are covered first, and there are <span className="font-bold text-ink">{stats?.slots.toLocaleString() ?? "—"}</span> paid slots in total. Get in early.</HowStep>
              </ol>
              <p className="mt-3 text-xs text-muted leading-relaxed">
                Each person can only ever be referred once, by whoever invited them first. Earnings are paid to your wallet when the competition ends.
              </p>
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
              <span className="text-muted">{you.count} referral{you.count === 1 ? "" : "s"}</span>
              {you.unlocked ? (
                <span className="inline-flex items-center gap-1 text-xs font-black text-ink bg-lime border border-ink rounded-full px-2 py-0.5">
                  <Check size={12} /> earned {fmtG(you.earnedWei)} G$
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-black text-ink bg-cream border border-ink rounded-full px-2 py-0.5">
                  <Lock size={12} /> {Math.max(0, threshold - you.count)} more to unlock
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm mb-5 text-sm text-muted">
          Sign in to get your invite link and start referring.
        </div>
      )}

      {/* Leaderboard */}
      <div className="flex items-center gap-2 mb-3">
        <UserPlus size={18} />
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
          <p className="font-bold">No referrals yet</p>
          <p className="text-sm text-muted">{phase === "live" ? "Share your invite link to get on the board." : "The competition hasn't started."}</p>
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
                      {!p.unlocked && (
                        <span title={`Needs ${threshold} referrals to unlock`}
                          className="inline-flex items-center gap-0.5 shrink-0 border border-ink rounded-full px-1.5 py-px text-[10px] font-black bg-cream">
                          <Lock size={10} /> {Math.max(0, threshold - p.count)} to unlock
                        </span>
                      )}
                    </div>
                    <div className="text-xs opacity-70 font-medium truncate">
                      {p.count} referral{p.count === 1 ? "" : "s"}
                      {p.unlocked && p.covered < p.count ? ` · ${p.covered} paid by the pot` : ""}
                    </div>
                  </Link>
                  <div className="text-right shrink-0">
                    <div className="font-black text-lg leading-none tabular-nums">{fmtG(p.earnedWei)}</div>
                    <div className="text-[11px] opacity-70 font-semibold uppercase tracking-wide">G$</div>
                  </div>
                  <button onClick={() => setExpanded(open ? null : p.root)} aria-label={open ? "Hide" : "Show referrals"}
                    className="w-8 h-8 rounded-lg border-2 border-ink flex items-center justify-center shrink-0 bg-cream">
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {open && (
                  <div className="px-3 pb-3 pt-0">
                    <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-1.5">
                      Referred ({p.invitees.length}){p.unlocked ? ` · ${p.covered} × ${perRefG.toLocaleString()} G$` : " · locked"}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {p.invitees.map((iv) => (
                        <Link key={iv.root} href={`/hunter/${iv.root}`}
                          className={clsx("inline-flex items-center gap-1 border-2 border-ink rounded-full pl-2 pr-2.5 py-1 text-xs font-bold transition-colors",
                            iv.covered ? "bg-lime hover:bg-lime/80" : "bg-cream hover:bg-lime")}
                          title={iv.covered ? `Paid ${perRefG.toLocaleString()} G$` : "Not covered by the pot"}>
                          <ProfileAvatar address={iv.root} size={16} ringColor="#111" />
                          {nameOrShort(iv.username, iv.root)}
                          {iv.covered && <Check size={11} />}
                          <ArrowUpRight size={11} className="opacity-60" />
                        </Link>
                      ))}
                      {p.invitees.length === 0 && <span className="text-xs text-muted">—</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-muted leading-relaxed">
        Every friend you bring who verifies with GoodDollar and does a task earns you {perRefG.toLocaleString()} G$,
        unlocked once you reach {threshold} referrals. The pot covers {stats?.slots.toLocaleString() ?? "—"} referrals in
        total, awarded in the order they happened, so earlier referrals are safest. Earnings are paid to your wallet when
        the competition ends.
      </p>
    </>
  );
}
