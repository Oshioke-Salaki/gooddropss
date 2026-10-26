"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProfiles } from "@/hooks/useProfile";
import {
  Trophy, Gift, Star, UserPlus, Coins, MapPin, Target, Network,
} from "lucide-react";
import { ordinal } from "@/app/leaderboard/components/RankBadge";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import {
  fmtG, fmtScore, useNow, usePoll,
  Countdown, HowStep, HowToPlay, StatCard, Chip, InviteLink, SignInCard, CrossLink, useOtherStanding,
  BoardHeader, BoardEmpty, BoardPodium, BoardRow, BoardRowSkeleton, PersonPill, YouBar,
  type Phase, type BoardEntry,
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

interface Props {
  address?: string;
  myLink: string;
  onSwitch: () => void;
  onSignIn?: () => void;
  /** Reports the competition phase up to the page header. */
  onPhase?: (p: Phase) => void;
}

const PAGE = 25;

// The POINTS competition: drop + claim + refer + downline network bonus, top-N
// split the pot. Only mounted while its tab is selected, so switching tabs never
// pays for the other board's computation.
export function PointsBoard({ address, myLink, onSwitch, onSignIn, onPhase }: Props) {
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
  useEffect(() => { if (data) onPhase?.(data.phase); }, [data, onPhase]);
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
  const other = useOtherStanding("/api/comp/referrals", address);
  const you = data?.you ?? null;
  const participants = data?.participants ?? [];

  // One batched profile request for every row's avatar, instead of one per row.
  const addresses = useMemo(() => participants.map((p) => p.root), [participants]);
  useProfiles(addresses);

  const entries: BoardEntry[] = useMemo(() => participants.map((p) => ({
    root: p.root,
    username: p.username,
    rank: p.rank,
    sub: `${p.reach} reached · ${p.claims} claimed · ${p.gDropped.toLocaleString()} G$ moved`,
    value: fmtScore(p.score),
    unit: p.score === 1 ? "point" : "points",
    tags: (p.refs > 0 || p.depth > 0) ? (
      <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0">
        {p.refs > 0 && (
          <span title={`Referred ${p.refs} ${p.refs === 1 ? "person" : "people"}`}
            className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-1 text-xs/none text-nav-muted">
            <UserPlus className="w-3 h-3" strokeWidth={2} /> {p.refs}
          </span>
        )}
        {p.depth > 0 && (
          <span title={`+${fmtScore(p.depth)} network bonus from ${p.downline} downline`}
            className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-1 text-xs/none text-nav-muted">
            <Network className="w-3 h-3" strokeWidth={2} /> +{fmtScore(p.depth)}
          </span>
        )}
      </span>
    ) : undefined,
  })), [participants]);

  const byRoot = useMemo(() => new Map(participants.map((p) => [p.root, p])), [participants]);
  const loading = !data;
  const showPodium = entries.length >= 3;
  const podium = showPodium ? entries.slice(0, 3) : [];
  const rest = showPodium ? entries.slice(3) : entries;
  const shown = rest.slice(0, visible);

  const details = (p: Participant) => (
    <>
      <div className="flex flex-wrap gap-2">
        <Chip tone="surface">{p.reach} drop pts</Chip>
        <Chip tone="surface">{p.claims} claim pts</Chip>
        <Chip tone="surface">{p.refs} referral pts</Chip>
        {p.depth > 0 && <Chip tone="surface">+{fmtScore(p.depth)} network · {p.downline}</Chip>}
        {p.prizeG > 0 && <Chip tone="brand" icon={<Gift strokeWidth={2} />}>In the money · {p.prizeG.toLocaleString()} G$</Chip>}
      </div>
      <div>
        <p className="text-sm/none text-nav-muted mb-3">Claimed their drops · {p.claimers.length}</p>
        <div className="flex flex-wrap gap-2">
          {p.claimers.map((c) => (
            <PersonPill
              key={c.root}
              root={c.root}
              username={c.username}
              active={c.referred}
              title={c.referred ? "Referred by them" : undefined}
              mark={c.referred ? <Star className="w-3.5 h-3.5 fill-current" strokeWidth={2} /> : undefined}
            />
          ))}
          {p.claimers.length === 0 && <span className="text-sm/none text-nav-muted">No claims on their drops yet.</span>}
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 lg:gap-12 items-start">
        {/* ── Left: overview + you ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-6 min-w-0">
          <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col gap-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-y-3 min-w-0">
                <span className="inline-flex items-center gap-2 self-start rounded-full bg-brand-soft text-brand px-3.5 py-2.5 text-sm/none">
                  <Trophy className="w-[18px] h-[18px]" strokeWidth={2} /> Points competition
                </span>
                {loading ? (
                  <Skeleton className="h-8 w-40 mt-1" />
                ) : (
                  <p className="text-[28px]/none lg:text-[32px]/none text-heading">
                    {fmtG(potWei)} <span className="text-nav-muted">G$</span>
                  </p>
                )}
                {loading ? <Skeleton className="h-[14px] w-40" /> : (
                  <p className="text-sm/none text-nav-muted">Prize pool · top {winners} share it</p>
                )}
              </div>
            </div>

            <p className="text-sm/[150%] text-nav-muted">
              Move real G$ to real people. Earn points three ways — <span className="text-heading">drop</span>,{" "}
              <span className="text-heading">claim</span> and <span className="text-heading">refer</span> — plus a bonus
              from everyone you bring in.
            </p>

            {loading ? (
              <div className="flex gap-2 lg:gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="flex-1 h-[68px] rounded-2xl" />)}</div>
            ) : (
              <Countdown phase={phase} target={target} now={now} />
            )}

            {/* Live stats */}
            <div className="grid grid-cols-2 gap-3">
              {stats ? (
                <>
                  <StatCard icon={<Coins className="w-5 h-5" strokeWidth={1.75} />} value={stats.gCirculated.toLocaleString()} label="G$ circulated" />
                  <StatCard icon={<MapPin className="w-5 h-5" strokeWidth={1.75} />} value={stats.drops.toLocaleString()} label="Drops" />
                  <StatCard icon={<Target className="w-5 h-5" strokeWidth={1.75} />} value={stats.claims.toLocaleString()} label="Claims" />
                  <StatCard icon={<UserPlus className="w-5 h-5" strokeWidth={1.75} />} value={stats.referredUsers.toLocaleString()} label="Referred" />
                </>
              ) : (
                [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)
              )}
            </div>

            {/* Prizes */}
            {tiers.length > 0 && (
              <div>
                <p className="text-sm/none text-nav-muted mb-3">Prizes · top {winners}</p>
                <div className="flex flex-wrap gap-2">
                  {tiers.map((g, i) => (
                    <Chip key={i} tone={i < 3 ? "brand" : "surface"}>
                      {ordinal(i + 1)} · {g.toLocaleString()} G$
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {/* How to play — collapsible to keep the card short */}
            {cfg && (
              <HowToPlay title="How to play" open={howOpen} onToggle={() => setHowOpen((v) => !v)}>
                <ol className="flex flex-col gap-y-4">
                  <HowStep n={1}><b>Drop</b> G$ around town{minDropG > 0 ? <> (at least <b>{minDropG.toLocaleString()} G$</b> a drop)</> : ""} and get people to claim it. Each <b>different person</b> who claims your drop is <b>1 point</b>.</HowStep>
                  <HowStep n={2}><b>Claim</b> other people&apos;s drops too. Each <b>different person</b> whose drop you claim is <b>1 point</b>.</HowStep>
                  <HowStep n={3}><b>Refer</b> new people with your link. Each friend who joins, verifies and plays is <b>{refPts}</b>.</HowStep>
                  <HowStep n={4}><b>Grow a team.</b> You also earn <b>{l1Pct}%</b> of the points your referrals score, and <b>{l2Pct}%</b> of the points their referrals score.</HowStep>
                </ol>
                <p className="text-sm/[150%] text-nav-muted">
                  Each person counts once for a drop and once for a claim, so the way to climb is to reach and claim with as many
                  <span className="text-heading"> different</span> people as you can. Both sides of every drop must be
                  GoodDollar-verified. Prizes for the top {winners} are paid to your wallet when the competition ends.
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
                  <Chip>{fmtScore(you.score)} pt{you.score === 1 ? "" : "s"}</Chip>
                  <Chip>{you.reach} reached</Chip>
                  <Chip>{you.claims} claimed</Chip>
                  {you.refs > 0 && <Chip>{you.refs} referred</Chip>}
                  {you.depth > 0 && <Chip>+{fmtScore(you.depth)} network</Chip>}
                  {you.prizeG > 0 && (
                    <Chip tone="brand" icon={<Gift strokeWidth={2} />}>In the money · {you.prizeG.toLocaleString()} G$</Chip>
                  )}
                </div>
              ) : null}
              <CrossLink
                label="Referral competition"
                icon={<UserPlus className="w-5 h-5" strokeWidth={1.75} />}
                standing={other}
                detail={other?.rank ? `${fmtG(other.earnedWei)} G$ earned there` : "Earn G$ for every friend you bring"}
                onSwitch={onSwitch}
              />
            </section>
          ) : (
            <SignInCard body="Sign in to get your invite link and join the competition." onSignIn={onSignIn} />
          )}
        </div>

        {/* ── Right: the board ─────────────────────────────────────────────── */}
        <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] overflow-hidden min-w-0">
          <BoardHeader
            title="Leaderboard"
            count={participants.length}
            countLabel="players"
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
              title="Nobody on the board yet"
              body={phase === "live" ? "Drop G$ for people, claim other drops and refer friends to get on the board." : "The competition hasn't started."}
            />
          ) : (
            <>
              {showPodium && <BoardPodium entries={podium} loading={false} />}
              <div className="border-t border-line lg:border-t-0">
                {podium.map((e) => (
                  <BoardRow
                    key={e.root}
                    className="lg:hidden"
                    e={e}
                    isMe={!!you && you.root === e.root}
                    open={expanded === e.root}
                    onToggle={() => setExpanded(expanded === e.root ? null : e.root)}
                    details={details(byRoot.get(e.root)!)}
                  />
                ))}
                {/* Desktop: the podium three still need their details somewhere —
                    they appear as rows only below lg, so at lg the podium cells
                    are the summary and details live in the rows list below. */}
                {podium.map((e) => (
                  <BoardRow
                    key={`lg-${e.root}`}
                    className="hidden lg:block"
                    e={e}
                    isMe={!!you && you.root === e.root}
                    open={expanded === e.root}
                    onToggle={() => setExpanded(expanded === e.root ? null : e.root)}
                    details={details(byRoot.get(e.root)!)}
                  />
                ))}
                {shown.map((e) => (
                  <BoardRow
                    key={e.root}
                    e={e}
                    isMe={!!you && you.root === e.root}
                    open={expanded === e.root}
                    onToggle={() => setExpanded(expanded === e.root ? null : e.root)}
                    details={details(byRoot.get(e.root)!)}
                  />
                ))}
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
          sub={`${you.reach} reached · ${you.claims} claimed`}
          value={fmtScore(you.score)}
          unit="points"
        />
      ) : null}
    </>
  );
}
