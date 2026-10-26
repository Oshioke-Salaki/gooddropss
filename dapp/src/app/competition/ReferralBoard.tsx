"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProfiles } from "@/hooks/useProfile";
import {
  Users, UserPlus, Coins, Lock, Check, Wallet, Trophy, AlertCircle,
} from "lucide-react";
import { ordinal } from "@/app/leaderboard/components/RankBadge";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import {
  fmtG, useNow, usePoll,
  Countdown, HowStep, HowToPlay, StatCard, Chip, InviteLink, SignInCard, CrossLink, useOtherStanding,
  BoardHeader, BoardEmpty, BoardPodium, BoardRow, BoardRowSkeleton, PersonPill, LockedTag, YouBar,
  type Phase, type BoardEntry,
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

interface Props {
  address?: string;
  myLink: string;
  onSwitch: () => void;
  onSignIn?: () => void;
  /** Reports the competition phase up to the page header. */
  onPhase?: (p: Phase) => void;
}

const PAGE = 25;

// The REFERRAL competition: a flat rate per qualifying referral, unlocked at a
// threshold, paid first-come-first-served until the pot is exhausted.
export function ReferralBoard({ address, myLink, onSwitch, onSignIn, onPhase }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [visible, setVisible] = useState(PAGE);

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
  useEffect(() => { if (data) onPhase?.(data.phase); }, [data, onPhase]);
  usePoll(load, !cfg || now < cfg.endsAt + 300);

  const target = cfg ? (now < cfg.startsAt ? cfg.startsAt : cfg.endsAt) : 0;
  const potWei = cfg?.potWei ?? "0";
  const perRefG = cfg ? Math.round(Number(cfg.perReferralWei) / 1e18) : 0;
  const threshold = cfg?.threshold ?? 5;
  const stats = data?.stats;
  const other = useOtherStanding("/api/comp/leaderboard", address);
  const you = data?.you ?? null;
  const participants = data?.participants ?? [];
  const slotsLeft = stats ? Math.max(0, stats.slots - stats.slotsUsed) : 0;
  const potGone = !!stats && slotsLeft === 0 && stats.slots > 0;

  // One batched profile request for every row's avatar, instead of one per row.
  const addresses = useMemo(() => participants.map((p) => p.root), [participants]);
  useProfiles(addresses);

  const entries: BoardEntry[] = useMemo(() => participants.map((p) => ({
    root: p.root,
    username: p.username,
    rank: p.rank,
    sub: `${p.count} referral${p.count === 1 ? "" : "s"}${p.unlocked && p.covered < p.count ? ` · ${p.covered} paid by the pot` : ""}`,
    value: fmtG(p.earnedWei),
    unit: "G$",
    tags: !p.unlocked ? <span className="hidden sm:inline-flex"><LockedTag n={Math.max(0, threshold - p.count)} /></span> : undefined,
  })), [participants, threshold]);

  const byRoot = useMemo(() => new Map(participants.map((p) => [p.root, p])), [participants]);
  const loading = !data;
  const showPodium = entries.length >= 3;
  const podium = showPodium ? entries.slice(0, 3) : [];
  const rest = showPodium ? entries.slice(3) : entries;
  const shown = rest.slice(0, visible);

  const details = (p: Participant) => (
    <div>
      <p className="text-sm/none text-nav-muted mb-3">
        Referred · {p.invitees.length}{p.unlocked ? ` · ${p.covered} × ${perRefG.toLocaleString()} G$` : " · locked"}
      </p>
      <div className="flex flex-wrap gap-2">
        {p.invitees.map((iv) => (
          <PersonPill
            key={iv.root}
            root={iv.root}
            username={iv.username}
            active={iv.covered}
            title={iv.covered ? `Paid ${perRefG.toLocaleString()} G$` : "Not covered by the pot"}
            mark={iv.covered ? <Check className="w-3.5 h-3.5" strokeWidth={2} /> : undefined}
          />
        ))}
        {p.invitees.length === 0 && <span className="text-sm/none text-nav-muted">No referrals yet.</span>}
      </div>
    </div>
  );

  const row = (e: BoardEntry, className?: string) => (
    <BoardRow
      key={`${className ?? ""}${e.root}`}
      className={className}
      e={e}
      isMe={!!you && you.root === e.root}
      open={expanded === e.root}
      onToggle={() => setExpanded(expanded === e.root ? null : e.root)}
      details={details(byRoot.get(e.root)!)}
    />
  );

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 lg:gap-12 items-start">
        {/* ── Left: overview + you ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-6 min-w-0">
          <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col gap-y-6">
            <div className="flex flex-col gap-y-3 min-w-0">
              <span className="inline-flex items-center gap-2 self-start rounded-full bg-brand-soft text-brand px-3.5 py-2.5 text-sm/none">
                <UserPlus className="w-[18px] h-[18px]" strokeWidth={2} /> Referral competition
              </span>
              {loading ? (
                <Skeleton className="h-8 w-40 mt-1" />
              ) : (
                <p className="text-[28px]/none lg:text-[32px]/none text-heading">
                  {fmtG(potWei)} <span className="text-nav-muted">G$</span>
                </p>
              )}
              {loading ? <Skeleton className="h-[14px] w-48" /> : (
                <p className="text-sm/none text-nav-muted">Prize pool · {perRefG.toLocaleString()} G$ per referral</p>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col gap-y-2.5"><Skeleton className="h-[14px] w-full" /><Skeleton className="h-[14px] w-5/6" /><Skeleton className="h-[14px] w-2/3" /></div>
            ) : (
              <p className="text-sm/[150%] text-nav-muted">
                Earn <span className="text-heading">{perRefG.toLocaleString()} G$</span> for every friend you bring who
                verifies and plays. Unlock your earnings at <span className="text-heading">{threshold} referrals</span>,
                then it&apos;s paid first come, first served until the pot runs out.
              </p>
            )}

            {loading ? (
              <div className="flex gap-2 lg:gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="flex-1 h-[68px] rounded-2xl" />)}</div>
            ) : (
              <Countdown phase={phase} target={target} now={now} />
            )}

            {/* Pot exhausted */}
            {potGone && (
              <div className="flex items-start gap-3 rounded-2xl bg-streak-bg p-4">
                <AlertCircle className="w-5 h-5 text-streak shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-sm/[150%] text-heading">
                  The {fmtG(potWei)} G$ referral pot has been fully claimed. Referrals after this point no longer earn.
                </p>
              </div>
            )}

            {/* Live stats */}
            <div className="grid grid-cols-2 gap-3">
              {stats ? (
                <>
                  <StatCard icon={<UserPlus className="w-5 h-5" strokeWidth={1.75} />} value={stats.referrals.toLocaleString()} label="Referrals" />
                  <StatCard icon={<Users className="w-5 h-5" strokeWidth={1.75} />} value={stats.qualifiedReferrers.toLocaleString()} label="Unlocked" />
                  <StatCard icon={<Coins className="w-5 h-5" strokeWidth={1.75} />} value={fmtG(stats.paidOutWei)} label="G$ earned" />
                  <StatCard icon={<Wallet className="w-5 h-5" strokeWidth={1.75} />} value={slotsLeft.toLocaleString()} label="Slots left" />
                </>
              ) : (
                [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)
              )}
            </div>

            {/* How it works */}
            {cfg && (
              <HowToPlay title="How it works" open={howOpen} onToggle={() => setHowOpen((v) => !v)}>
                <ol className="flex flex-col gap-y-4">
                  <HowStep n={1}>Share your invite link. Your friend joins through it, verifies with GoodDollar (one face scan), and does a task — claims or creates a drop.</HowStep>
                  <HowStep n={2}>That counts as <b>1 referral</b>, worth <b>{perRefG.toLocaleString()} G$</b>.</HowStep>
                  <HowStep n={3}>Reach <b>{threshold} referrals</b> to <b>unlock</b> your earnings. Below {threshold} you earn nothing, so push to {threshold} first.</HowStep>
                  <HowStep n={4}>The pot pays <b>first come, first served</b> — earlier referrals are covered first, and there are <b>{stats?.slots.toLocaleString() ?? "—"}</b> paid slots in total. Get in early.</HowStep>
                </ol>
                <p className="text-sm/[150%] text-nav-muted">
                  Each person can only ever be referred once, by whoever invited them first. Earnings are paid to your
                  wallet when the competition ends.
                </p>
              </HowToPlay>
            )}
          </section>

          {/* Your invite link + position */}
          {address ? (
            <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col gap-y-5">
              <h2 className="text-xl/none text-heading">Your invite link</h2>
              <InviteLink myLink={myLink} />
              {loading ? (
                <Skeleton className="h-10 w-48" />
              ) : you ? (
                <div className="flex flex-wrap gap-2">
                  <Chip tone={you.rank ? "brand" : "surface"} icon={<Trophy strokeWidth={2} />}>
                    {you.rank ? `You're ${ordinal(you.rank)}` : "Not on the board yet"}
                  </Chip>
                  <Chip>{you.count} referral{you.count === 1 ? "" : "s"}</Chip>
                  {you.unlocked ? (
                    <Chip tone="brand" icon={<Check strokeWidth={2} />}>Earned {fmtG(you.earnedWei)} G$</Chip>
                  ) : (
                    <Chip tone="surface" icon={<Lock strokeWidth={2} />}>{Math.max(0, threshold - you.count)} more to unlock</Chip>
                  )}
                </div>
              ) : null}
              <CrossLink
                label="Points competition"
                icon={<Trophy className="w-5 h-5" strokeWidth={1.75} />}
                standing={other}
                detail={other?.rank ? `${other.score} points there` : "Drop, claim and refer for a share of the pot"}
                onSwitch={onSwitch}
              />
            </section>
          ) : (
            <SignInCard body="Sign in to get your invite link and start referring." onSignIn={onSignIn} />
          )}
        </div>

        {/* ── Right: the board ─────────────────────────────────────────────── */}
        <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] overflow-hidden min-w-0">
          <BoardHeader
            title="Leaderboard"
            count={participants.length}
            countLabel="referrers"
            refreshing={refreshing}
            onRefresh={refresh}
            loading={loading}
          />
          {loading ? (
            <>
              <BoardPodium entries={[]} loading />
              <div className="border-t border-line lg:border-t-0">
                {Array.from({ length: 6 }, (_, i) => <BoardRowSkeleton key={i} />)}
              </div>
            </>
          ) : entries.length === 0 ? (
            <BoardEmpty
              title="No referrals yet"
              body={phase === "live" ? "Share your invite link to get on the board." : "The competition hasn't started."}
            />
          ) : (
            <>
              {showPodium && <BoardPodium entries={podium} loading={false} />}
              <div className="border-t border-line lg:border-t-0">
                {podium.map((e) => row(e, "lg:hidden"))}
                {podium.map((e) => row(e, "hidden lg:block"))}
                {shown.map((e) => row(e))}
              </div>
              {rest.length > visible && (
                <div className="p-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisible((v) => v + PAGE)}
                    className="rounded-full bg-surface hover:bg-nav-controls px-6 py-3 text-sm/none text-heading cursor-pointer motion-safe:transition-colors"
                  >
                    Show {Math.min(PAGE, rest.length - visible)} more
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Your standing, pinned — only once the board is real and you're on it. */}
      {you?.rank ? (
        <YouBar
          rank={you.rank}
          root={you.root}
          sub={`${you.count} referral${you.count === 1 ? "" : "s"}`}
          value={fmtG(you.earnedWei)}
          unit="G$"
        />
      ) : null}
    </>
  );
}
