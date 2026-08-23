"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { inviteUrl } from "@/lib/referral";
import { Users, Trophy, Gift, Wallet, Copy, Check, ChevronDown, ChevronUp, ArrowUpRight } from "lucide-react";
import clsx from "clsx";

interface Invitee { root: string; username: string | null }
interface Participant {
  root: string; username: string | null; referralCount: number;
  owedWei: string; paidWei: string; outstandingWei: string; invitees: Invitee[];
}
interface Data {
  ok: boolean;
  phase: "upcoming" | "live" | "ended";
  config: { startsAt: number; endsAt: number; potWei: string; perReferralWei: string; threshold: number };
  potSpentWei: string;
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

export default function CompetitionPage() {
  const { address } = useAccount();
  const [data, setData] = useState<Data | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = address ? `?address=${address}` : "";
    fetch(`/api/comp/leaderboard${q}`, { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {});
  }, [address]);
  useEffect(() => { load(); }, [load]);

  const now = useNow();
  const cfg = data?.config;
  const phase = data?.phase ?? "upcoming";

  // Poll while the contest is live (+5 min grace so the final board settles), and
  // refresh instantly when the tab regains focus.
  const pollActive = !cfg || now < cfg.endsAt + 300;
  useEffect(() => {
    if (!pollActive) return;
    const id = setInterval(load, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [pollActive, load]);

  const target = cfg ? (now < cfg.startsAt ? cfg.startsAt : cfg.endsAt) : 0;
  const remaining = Math.max(0, target - now);
  const days = Math.floor(remaining / 86400), hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60), secs = remaining % 60;

  const potWei = cfg?.potWei ?? "0";
  const spentWei = data?.potSpentWei ?? "0";
  const remainingWei = cfg ? (BigInt(potWei) - BigInt(spentWei) > 0n ? (BigInt(potWei) - BigInt(spentWei)).toString() : "0") : "0";
  const threshold = cfg?.threshold ?? 5;
  const perRef = cfg?.perReferralWei ?? (6500n * 10n ** 18n).toString();
  const pctSpent = cfg && BigInt(potWei) > 0n ? Math.min(100, Number((BigInt(spentWei) * 100n) / BigInt(potWei))) : 0;

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
            <Users size={13} /> REFERRAL COMPETITION
          </div>
          <p className="font-black text-4xl leading-none">{fmtG(potWei)} <span className="text-lime">G$</span></p>
          <p className="text-sm text-cream/70 mt-2 leading-relaxed">
            Refer verified hunters who claim or drop. Hit {threshold} referrals to unlock{" "}
            <span className="text-lime font-bold">{fmtG(perRef)} G$</span> each — paid straight to your wallet.
          </p>

          {/* Pot progress */}
          <div className="mt-4 text-left">
            <div className="flex items-center justify-between text-[11px] font-bold text-cream/70 mb-1">
              <span>{fmtG(spentWei)} G$ paid out</span>
              <span>{fmtG(remainingWei)} G$ left</span>
            </div>
            <div className="h-2.5 bg-cream/15 rounded-full overflow-hidden">
              <div className="h-full bg-lime rounded-full transition-all" style={{ width: `${pctSpent}%` }} />
            </div>
          </div>

          {/* Countdown */}
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
              <HowStep n={1}>Copy your invite link below and share it with friends.</HowStep>
              <HowStep n={2}>A friend joins through your link, verifies with GoodDollar (one face scan), then claims or creates a drop.</HowStep>
              <HowStep n={3}>That counts as <span className="font-bold text-ink">one referral</span>. Each person only ever counts once.</HowStep>
              <HowStep n={4}>Reach <span className="font-bold text-ink">{threshold} referrals</span> to unlock — you earn <span className="font-bold text-ink">{fmtG(perRef)} G$</span> for every one ({(threshold * Math.round(Number(perRef) / 1e18)).toLocaleString()} G$ for the first {threshold}).</HowStep>
              <HowStep n={5}>Every referral after that is another {fmtG(perRef)} G$ — paid <span className="font-bold text-ink">straight to your wallet</span>, automatically.</HowStep>
            </ol>
            <p className="text-xs text-muted mt-3 leading-relaxed">
              Ends {new Date(cfg.endsAt * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, or when the {fmtG(potWei)} G$ pot runs out — whichever comes first.
            </p>
          </div>
        )}

        {/* Your invite link */}
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
                <span className="text-muted">{you.referralCount} referral{you.referralCount === 1 ? "" : "s"}</span>
                <span className="text-muted">Earned {fmtG(you.paidWei)} G$</span>
                {BigInt(you.outstandingWei) > 0n && (
                  <span className="inline-flex items-center gap-1 text-xs font-black text-ink bg-[#FFF4E0] border border-ink rounded-full px-2 py-0.5">
                    <Wallet size={12} /> {fmtG(you.outstandingWei)} G$ pending
                  </span>
                )}
                {you.rank === null && you.referralCount > 0 && you.referralCount < threshold && (
                  <span className="text-muted">{threshold - you.referralCount} more to unlock</span>
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
        </div>

        {!data ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 bg-border rounded-2xl animate-pulse" />)}</div>
        ) : participants.length === 0 ? (
          <div className="text-center py-14 space-y-2">
            <Users size={40} className="mx-auto text-muted" strokeWidth={1.5} />
            <p className="font-bold">No referrals yet</p>
            <p className="text-sm text-muted">{phase === "live" ? "Share your link to get on the board." : "The competition hasn't started."}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {participants.map((p, i) => {
              const rank = i + 1, top3 = rank <= 3;
              const isMe = !!you && you.root === p.root;
              const unlocked = p.referralCount >= threshold;
              const open = expanded === p.root;
              const rankBg = rank === 1 ? "bg-[#FFD700] border-ink text-ink"
                : rank === 2 ? "bg-[#C0C0C0] border-ink text-ink"
                : rank === 3 ? "bg-[#CD7F32] border-ink text-white"
                : "bg-border text-muted";
              return (
                <div key={p.root} className={clsx("border-2 border-ink rounded-2xl min-w-0", isMe ? "bg-lime shadow-brutal" : "bg-card shadow-brutal-sm")}>
                  <div className="flex items-center gap-3 px-3 py-3">
                    <div className={clsx("w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-black shrink-0", rankBg)}>{rank}</div>
                    <ProfileAvatar address={p.root} size={34} ringColor={top3 ? "#111" : "#d6d5cf"} />
                    <Link href={`/hunter/${p.root}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                      <div className="font-bold text-sm truncate">{nameOrShort(p.username, p.root)}</div>
                      <div className="text-xs opacity-70 font-medium">
                        {unlocked ? <>Earned {fmtG(p.paidWei)} G${BigInt(p.outstandingWei) > 0n && <> · <span className="font-bold">{fmtG(p.outstandingWei)} pending</span></>}</>
                          : <>{threshold - p.referralCount} more to unlock</>}
                      </div>
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="font-black text-xl leading-none tabular-nums">{p.referralCount}</div>
                      <div className="text-[11px] opacity-70 font-semibold uppercase tracking-wide">referrals</div>
                    </div>
                    <button
                      onClick={() => setExpanded(open ? null : p.root)}
                      aria-label={open ? "Hide referred users" : "Show referred users"}
                      className="w-8 h-8 rounded-lg border-2 border-ink flex items-center justify-center shrink-0 bg-cream"
                    >
                      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {open && (
                    <div className="px-3 pb-3 pt-0">
                      <p className="text-[11px] font-black uppercase tracking-wider text-muted mb-2">Referred hunters ({p.invitees.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {p.invitees.map((iv) => (
                          <Link
                            key={iv.root}
                            href={`/hunter/${iv.root}`}
                            className="inline-flex items-center gap-1 bg-cream border-2 border-ink rounded-full pl-2 pr-2.5 py-1 text-xs font-bold hover:bg-lime transition-colors"
                          >
                            <ProfileAvatar address={iv.root} size={16} ringColor="#111" />
                            {nameOrShort(iv.username, iv.root)}
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

        <div className="mt-6 flex items-start gap-2 text-xs text-muted leading-relaxed">
          <Gift size={14} className="shrink-0 mt-0.5" />
          <p>Only verified hunters who claim or create a drop count as referrals. Rewards are paid automatically from the reward wallet; if the wallet is topped up between payouts, any pending amount settles on the next run.</p>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
