"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { inviteUrl } from "@/lib/referral";
import { Users, Trophy, Gift, Copy, Check, ChevronDown, ChevronUp, ArrowUpRight, RefreshCw, MapPin, Star } from "lucide-react";
import clsx from "clsx";

interface ClaimerRef { root: string; username: string | null; referred: boolean; gG: number }
interface Participant {
  root: string; username: string | null;
  reach: number; referred: number; score: number; dropsClaimed: number; gDropped: number;
  rank: number; prizeG: number; claimers: ClaimerRef[];
}
interface Data {
  ok: boolean;
  mode: "tiered" | "flat";
  phase: "upcoming" | "live" | "ended";
  config: { startsAt: number; endsAt: number; potWei: string; tiers: number[]; minDropWei: string | null };
  participants: Participant[];
  you: (Participant & { rank: number | null }) | null;
}

const fmtG = (wei: string) => Math.round(Number(wei) / 1e18).toLocaleString();
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pad = (n: number) => String(n).padStart(2, "0");
const nameOrShort = (u: string | null, root: string) => (u ? `@${u}` : shortAddr(root));

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function HowStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-lime border-2 border-ink flex items-center justify-center font-black text-xs">{n}</span>
      <span className="text-sm text-ink leading-snug">{children}</span>
    </li>
  );
}

function CountBox({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="bg-ink text-lime border-2 border-ink rounded-xl w-14 py-2 text-center font-black text-2xl tabular-nums shadow-brutal-sm">{pad(value)}</div>
      <span className="text-[10px] font-black uppercase tracking-wider text-muted mt-1">{unit}</span>
    </div>
  );
}

const rankBg = (rank: number) =>
  rank === 1 ? "bg-[#FFD700] border-ink text-ink"
  : rank === 2 ? "bg-[#C0C0C0] border-ink text-ink"
  : rank === 3 ? "bg-[#CD7F32] border-ink text-white"
  : "bg-border text-muted";

export default function CompetitionPage() {
  const { address } = useAccount();
  const [data, setData] = useState<Data | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
  const phase = data?.phase ?? "upcoming";

  const pollActive = !cfg || now < cfg.endsAt + 300;
  useEffect(() => {
    if (!pollActive) return;
    const id = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [pollActive, load]);

  const target = cfg ? (now < cfg.startsAt ? cfg.startsAt : cfg.endsAt) : 0;
  const remaining = Math.max(0, target - now);
  const days = Math.floor(remaining / 86400), hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60), secs = remaining % 60;

  const potWei = cfg?.potWei ?? "0";
  const tiers = cfg?.tiers ?? [];
  const winners = tiers.length;
  const minDropG = cfg?.minDropWei ? Math.round(Number(cfg.minDropWei) / 1e18) : 0;

  const origin = typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz";
  const myLink = address ? inviteUrl(origin, address) : "";
  function copyLink() {
    if (!myLink) return;
    navigator.clipboard?.writeText(myLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }

  const you = data?.you ?? null;
  const participants = data?.participants ?? [];

  return (
    <div className="min-h-screen bg-cream pb-24">
      <Nav />
      <div className="max-w-screen-md mx-auto px-4 pt-20 pb-8">

        {/* Hero */}
        <div className="bg-ink text-cream border-2 border-ink rounded-2xl p-5 shadow-brutal mb-5 text-center">
          <div className="inline-flex items-center gap-1.5 bg-lime text-ink font-black text-xs px-3 py-1 rounded-full mb-3">
            <Trophy size={13} /> THE BIG DROP · OUR BIGGEST EVER
          </div>
          <p className="font-black text-4xl leading-none">{fmtG(potWei)} <span className="text-lime">G$</span></p>
          <p className="text-sm text-cream/70 mt-2 leading-relaxed">
            Drop real G$ for people and get them to <span className="text-lime font-bold">claim it</span>. The more
            <span className="text-lime font-bold"> different people</span> claim your drops, the higher you climb.
            The <span className="text-lime font-bold">top {winners}</span> split the pot.
          </p>

          <div className="mt-4">
            <p className="text-[11px] font-black uppercase tracking-wider text-lime mb-2">
              {phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "Competition ended"}
            </p>
            {phase !== "ended" ? (
              <div className="flex items-end justify-center gap-2.5">
                <CountBox value={days} unit="days" /><CountBox value={hours} unit="hrs" />
                <CountBox value={mins} unit="min" /><CountBox value={secs} unit="sec" />
              </div>
            ) : (
              <p className="font-black text-lg text-lime">Final standings below</p>
            )}
          </div>
        </div>

        {/* How it works */}
        {cfg && (
          <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm mb-5">
            <p className="font-black text-base mb-3">How it works</p>
            <ol className="space-y-2.5">
              <HowStep n={1}>Get G$ into your wallet (your ambassador lead funds you), then <span className="font-bold text-ink">drop</span> it around town — {minDropG > 0 ? <>at least <span className="font-bold text-ink">{minDropG.toLocaleString()} G$</span> per drop</> : "any amount"}.</HowStep>
              <HowStep n={2}>Send a <span className="font-bold text-ink">different person</span> to each drop and make sure they <span className="font-bold text-ink">claim it</span>. Every new person who claims one of your drops = <span className="font-bold text-ink">1 point</span>.</HowStep>
              <HowStep n={3}>Invite brand-new people with your link below. When someone <span className="font-bold text-ink">you referred</span> claims your drop, it counts <span className="font-bold text-ink">double</span>.</HowStep>
              <HowStep n={4}>Reach as many <span className="font-bold text-ink">different</span> people as you can. The <span className="font-bold text-ink">top {winners}</span> split {fmtG(potWei)} G$.</HowStep>
            </ol>
            <p className="mt-3 text-xs text-muted leading-relaxed">
              Each person counts once, so reaching new people is how you climb — dropping for the same few again won&apos;t add more points.
              Both the dropper and the claimer must be GoodDollar-verified.
            </p>
          </div>
        )}

        {/* Prize tiers */}
        {tiers.length > 0 && (
          <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm mb-5">
            <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted mb-2">Prizes · top {winners}</p>
            <div className="flex flex-wrap gap-1.5">
              {tiers.map((g, i) => (
                <span key={i} className={clsx("inline-flex items-center gap-1 border-2 border-ink rounded-full px-2.5 py-1 text-xs font-black", rankBg(i + 1))}>
                  #{i + 1} · {g.toLocaleString()} G$
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Your invite link + position */}
        {address ? (
          <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm mb-5">
            <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-2">Your invite link</p>
            <div className="flex items-center gap-2">
              <input readOnly value={myLink} className="flex-1 min-w-0 border-2 border-ink rounded-lg px-3 py-2 text-xs font-mono bg-cream outline-none" />
              <button onClick={copyLink} className="btn-brutal flex items-center gap-1.5 px-3 py-2 rounded-lg font-black text-sm bg-lime text-ink shrink-0">
                {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
              </button>
            </div>
            {you && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-bold">{you.rank ? `You're #${you.rank}` : "Not on the board yet"}</span>
                <span className="text-muted">{you.score} pt{you.score === 1 ? "" : "s"} · {you.reach} reached{you.referred > 0 ? ` · ${you.referred} referred` : ""}</span>
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
            <p className="text-sm text-muted">{phase === "live" ? "Drop G$ for people around you and get them to claim it." : "The competition hasn't started."}</p>
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
                      <div className="font-bold text-sm truncate">{nameOrShort(p.username, p.root)}</div>
                      <div className="text-xs opacity-70 font-medium truncate">
                        {p.reach} reached{p.referred > 0 ? ` · ${p.referred} referred` : ""} · {p.gDropped.toLocaleString()} G$ moved
                      </div>
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="font-black text-xl leading-none tabular-nums">{p.score}</div>
                      <div className="text-[11px] opacity-70 font-semibold uppercase tracking-wide">points</div>
                    </div>
                    <button onClick={() => setExpanded(open ? null : p.root)} aria-label={open ? "Hide" : "Show people who claimed"}
                      className="w-8 h-8 rounded-lg border-2 border-ink flex items-center justify-center shrink-0 bg-cream">
                      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                  {open && (
                    <div className="px-3 pb-3 pt-0">
                      <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-2">
                        Claimed your drops ({p.claimers.length}){p.prizeG > 0 ? <span className="text-ink"> · in the money: {p.prizeG.toLocaleString()} G$</span> : ""}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {p.claimers.map((c) => (
                          <Link key={c.root} href={`/hunter/${c.root}`}
                            className={clsx("inline-flex items-center gap-1 border-2 border-ink rounded-full pl-2 pr-2.5 py-1 text-xs font-bold transition-colors",
                              c.referred ? "bg-lime hover:bg-lime/80" : "bg-cream hover:bg-lime")}
                            title={c.referred ? "You referred this person — counts double" : undefined}>
                            <ProfileAvatar address={c.root} size={16} ringColor="#111" />
                            {nameOrShort(c.username, c.root)}
                            {c.referred && <Star size={11} className="fill-ink" />}
                            <ArrowUpRight size={11} className="opacity-60" />
                          </Link>
                        ))}
                        {p.claimers.length === 0 && <span className="text-xs text-muted">—</span>}
                      </div>
                      {p.claimers.some((c) => c.referred) && (
                        <p className="mt-2 text-[11px] text-muted flex items-center gap-1"><Star size={10} className="fill-ink" /> = someone you referred (counts double)</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex items-start gap-2 text-xs text-muted leading-relaxed">
          <MapPin size={14} className="shrink-0 mt-0.5" />
          <p>You score by reaching real, different people: each distinct verified person who claims one of your drops is 1 point, and someone you referred counts double. Each person counts once, so the way to climb is to reach <span className="font-semibold text-ink">more different people</span> — dropping for the same few again is fine, it just won&apos;t add more points. Prizes for the top {winners} are paid to your wallet when the competition ends.</p>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
