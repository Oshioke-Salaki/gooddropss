"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, ChevronDown, ChevronUp, Copy, Lock, RefreshCw, Timer, Users,
} from "lucide-react";
import clsx from "clsx";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { openProfile } from "@/components/profile/ProfileDrawer";
import { Skeleton, IdentitySkeleton, AmountSkeleton } from "@/app/leaderboard/components/Skeleton";
import { RankBadge, ordinal } from "@/app/leaderboard/components/RankBadge";
import { track } from "@/lib/analytics";

// Shared presentation helpers for the two competition boards (points + referrals).
export const fmtG = (wei: string) => Math.round(Number(wei) / 1e18).toLocaleString();
export const fmtScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const nameOrShort = (u: string | null, root: string) => (u ? `@${u}` : shortAddr(root));
const pad = (n: number) => String(n).padStart(2, "0");

export type Phase = "upcoming" | "live" | "ended";

export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ── Page chrome ───────────────────────────────────────────────────────────────

/** Live / starts soon / ended — sits beside the page title. */
export function PhasePill({ phase, loading }: { phase: Phase; loading: boolean }) {
  if (loading) return <Skeleton className="h-9 w-24" />;
  const copy = phase === "live" ? "Live now" : phase === "upcoming" ? "Starting soon" : "Ended";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 h-9 px-4 rounded-full text-sm/none whitespace-nowrap",
        phase === "live" ? "bg-brand-soft text-brand" : "bg-white text-nav-muted",
      )}
    >
      {phase === "live" && (
        <Timer aria-hidden className="w-4 h-4" strokeWidth={2} />
      )}
      {copy}
    </span>
  );
}

/** Kept for the admin tooling that still reads it; the boards use RankBadge now. */
export const rankBg = (rank: number) =>
  rank === 1 ? "bg-[#FFD700] text-heading"
  : rank === 2 ? "bg-[#C0C0C0] text-heading"
  : rank === 3 ? "bg-[#CD7F32] text-white"
  : "bg-surface text-nav-muted";

// ── Overview card pieces ──────────────────────────────────────────────────────

export function HowStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-surface font-anta text-xs text-heading flex items-center justify-center">
        {n}
      </span>
      <span className="text-sm/[150%] text-nav-muted pt-1 [&_b]:font-normal [&_b]:text-heading">{children}</span>
    </li>
  );
}

/** Collapsible "How to play" — keeps the overview card short by default. */
export function HowToPlay({
  title, open, onToggle, children,
}: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border-t border-line -mx-6 px-6 pt-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left cursor-pointer group"
      >
        <span className="text-lg/none text-heading">{title}</span>
        <span className="w-9 h-9 rounded-full bg-surface flex items-center justify-center text-heading shrink-0
          motion-safe:transition-colors group-hover:bg-nav-controls">
          {open ? <ChevronUp className="w-[18px] h-[18px]" strokeWidth={2} /> : <ChevronDown className="w-[18px] h-[18px]" strokeWidth={2} />}
        </span>
      </button>
      {open && <div className="pt-5 flex flex-col gap-y-5">{children}</div>}
    </div>
  );
}

function CountBox({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="flex-1 min-w-0 bg-surface rounded-2xl py-3 flex flex-col items-center gap-y-2">
      <span className="font-anta text-2xl/none text-heading tabular-nums">{pad(value)}</span>
      <span className="text-xs/none text-nav-muted">{unit}</span>
    </div>
  );
}

// Countdown to start (before it opens) or to the finish line (while live).
export function Countdown({ phase, target, now }: { phase: Phase; target: number; now: number }) {
  const remaining = Math.max(0, target - now);
  const days = Math.floor(remaining / 86400), hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60), secs = remaining % 60;
  return (
    <div>
      <p className="text-sm/none text-nav-muted mb-3">
        {phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "Competition ended"}
      </p>
      {phase !== "ended" ? (
        <div className="flex gap-2 lg:gap-3">
          <CountBox value={days} unit="days" /><CountBox value={hours} unit="hrs" />
          <CountBox value={mins} unit="min" /><CountBox value={secs} unit="sec" />
        </div>
      ) : (
        <p className="text-lg/none text-heading">Final standings are in</p>
      )}
    </div>
  );
}

/** Live-stat tile: value on top, label under. Four of them share one row. */
export function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    // Stacked on phones (two tiles share 330px, so "406,687" needs the width),
    // icon-beside-text once there's room.
    <div className="bg-surface rounded-2xl px-4 py-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center min-w-0">
      <span className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-heading shrink-0">{icon}</span>
      <div className="flex flex-col gap-y-1.5 min-w-0">
        <span className="text-lg/none text-heading tabular-nums truncate">{value}</span>
        <span className="text-sm/none text-nav-muted truncate">{label}</span>
      </div>
    </div>
  );
}

/** Small stat chip for a person's own line: "313.5 pts", "27 reached". */
export function Chip({ icon, children, tone = "line" }: {
  icon?: React.ReactNode; children: React.ReactNode; tone?: "line" | "brand" | "surface" | "streak";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-2.5 text-sm/none whitespace-nowrap",
        tone === "brand" && "bg-brand-soft text-brand",
        tone === "surface" && "bg-surface text-heading",
        tone === "streak" && "bg-streak-bg text-heading",
        tone === "line" && "border border-line bg-white text-heading",
      )}
    >
      {icon && <span className="shrink-0 [&_svg]:w-[18px] [&_svg]:h-[18px]">{icon}</span>}
      {children}
    </span>
  );
}

// Your personal invite link + copy button — identical on both boards.
export function InviteLink({ myLink }: { myLink: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!myLink) return;
    navigator.clipboard?.writeText(myLink).then(() => {
      track("invite_link_copied");
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }
  const label = myLink.replace(/^https?:\/\//, "");
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div
        className="w-full sm:flex-1 min-w-0 h-11 rounded-full border border-line px-5 flex items-center text-sm/none text-nav-muted"
        title={myLink}
      >
        <span className="truncate">{label}</span>
      </div>
      <button
        type="button"
        onClick={copy}
        className="h-11 px-6 rounded-full text-sm/none text-heading flex items-center justify-center gap-2 shrink-0
          cursor-pointer border border-transparent motion-safe:transition-opacity hover:opacity-80 whitespace-nowrap"
        style={{
          background: "linear-gradient(#fff, #fff) padding-box, linear-gradient(90deg, #F5C79B, #EEADF5) border-box",
        }}
      >
        {copied ? <Check className="w-[18px] h-[18px] text-brand" /> : <Copy className="w-[18px] h-[18px]" strokeWidth={1.75} />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

/** Signed-out version of the "you" card. */
export function SignInCard({ body, onSignIn }: { body: string; onSignIn?: () => void }) {
  return (
    <div className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <p className="flex-1 text-sm/[140%] text-nav-muted">{body}</p>
      {onSignIn && (
        <button
          type="button"
          onClick={onSignIn}
          className="h-11 px-5 rounded-full bg-brand text-white text-sm/none cursor-pointer whitespace-nowrap shrink-0
            motion-safe:transition-colors hover:bg-brand/90"
        >
          Sign in
        </button>
      )}
    </div>
  );
}

// Your standing in the OTHER competition. Uses each board's `?me=1` mode, which
// returns just your rank instead of the whole leaderboard — a few hundred bytes,
// CDN-cached, fetched once after mount and only when signed in.
export interface Standing { rank: number | null; count: number; earnedWei: string; score: number }
export function useOtherStanding(endpoint: string, address?: string) {
  const [s, setS] = useState<Standing | null>(null);
  useEffect(() => {
    if (!address) { setS(null); return; }
    let alive = true;
    fetch(`${endpoint}?me=1&address=${address}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.ok) return;
        setS({ rank: d.rank ?? null, count: d.count ?? 0, earnedWei: d.earnedWei ?? "0", score: d.score ?? 0 });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [endpoint, address]);
  return s;
}

// "You're also #N in the other competition" nudge, so nobody misses the second pot.
export function CrossLink({ label, standing, detail, onSwitch, icon }: {
  label: string; standing: Standing | null; detail: string; onSwitch: () => void; icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSwitch}
      className="w-full flex items-center gap-3 border border-line rounded-full p-2 pr-4 bg-white text-left cursor-pointer
        motion-safe:transition-colors hover:bg-surface/60"
    >
      <span className="w-11.5 h-11.5 rounded-full bg-surface flex items-center justify-center text-heading shrink-0">
        {icon ?? <Users className="w-5 h-5" strokeWidth={1.75} />}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-y-1.5">
        <span className="text-base/none text-heading truncate">
          {standing?.rank ? `You're ${ordinal(standing.rank)} in ${label.toLowerCase()}` : label}
        </span>
        <span className="text-sm/none text-nav-muted truncate">{detail}</span>
      </span>
      <ArrowRight className="w-5 h-5 text-heading shrink-0" strokeWidth={1.75} />
    </button>
  );
}

// Shared polling: refresh every 60s while the contest is still relevant, and
// immediately when the tab regains focus.
export function usePoll(load: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [active, load]);
}

// ── Board pieces ──────────────────────────────────────────────────────────────

/** Board card header: title + stat chips + refresh. */
export function BoardHeader({
  title, count, countLabel, refreshing, onRefresh, loading,
}: { title: string; count: number; countLabel: string; refreshing: boolean; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="p-6 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-xl/none text-heading">{title}</h2>
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <span className="hidden sm:inline-flex items-center gap-2 bg-surface rounded-full px-4 py-2.5 text-sm/none whitespace-nowrap">
            <span className="text-heading">{count.toLocaleString("en-US")}</span>
            <span className="text-nav-muted">{countLabel}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh leaderboard"
        title="Refresh"
        className="w-10 h-10 rounded-full bg-surface text-heading flex items-center justify-center shrink-0 cursor-pointer
          motion-safe:transition-colors hover:bg-nav-controls disabled:cursor-wait"
      >
        <RefreshCw className={clsx("w-[18px] h-[18px]", refreshing && "animate-spin")} strokeWidth={2} />
      </button>
    </div>
  );
}

export function BoardEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-t border-line px-6 py-20 text-center">
      <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-nav-muted mx-auto mb-4">
        <Users className="w-6 h-6" strokeWidth={1.5} />
      </span>
      <p className="text-lg/none text-heading mb-3">{title}</p>
      <p className="text-sm/[140%] text-nav-muted max-w-xs mx-auto">{body}</p>
    </div>
  );
}

export interface BoardEntry {
  root: string;
  username: string | null;
  rank: number;
  /** One line under the name: "27 reached · 27 claimed". */
  sub: string;
  value: string;
  unit: string;
  /** Small tags beside the name (referrals, locked, …). */
  tags?: React.ReactNode;
}

const MEDALS = ["/first-medal.svg", "/second-medal.svg", "/third-medal.svg"];

function Identity({ e, onDark = false }: { e: BoardEntry; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-x-3 lg:gap-x-4 min-w-0">
      <span className="lg:hidden shrink-0"><ProfileAvatar address={e.root} size={38} ringColor="transparent" /></span>
      <span className="hidden lg:block shrink-0"><ProfileAvatar address={e.root} size={46} ringColor="transparent" /></span>
      <div className="flex flex-col gap-y-2.5 lg:gap-y-3 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <Link
            href={`/hunter/${e.root}`}
            onClick={(ev) => ev.stopPropagation()}
            className={clsx("text-base/none lg:text-lg/none truncate motion-safe:transition-opacity hover:opacity-80",
              onDark ? "text-white" : "text-heading")}
          >
            {nameOrShort(e.username, e.root)}
          </Link>
          {e.tags}
        </span>
        <span className={clsx("text-sm/none truncate", onDark ? "text-white/70" : "text-nav-muted")}>{e.sub}</span>
      </div>
    </div>
  );
}

function Amount({ e, onDark = false }: { e: BoardEntry; onDark?: boolean }) {
  return (
    <div className="flex flex-col gap-y-2.5 lg:gap-y-3 items-end shrink-0">
      <span className={clsx("text-base/none lg:text-lg/none tabular-nums", onDark ? "text-white" : "text-heading")}>{e.value}</span>
      <span className={clsx("text-sm/none", onDark ? "text-white/70" : "text-nav-muted")}>{e.unit}</span>
    </div>
  );
}

/**
 * Top three, side by side — desktop only. Below lg the same three render as
 * ordinary rows whose rank badge is the medal, exactly like the leaderboard.
 *
 * The board card is narrower than the leaderboard page (it shares the row with
 * the overview card), so each cell stacks name, sub and amount under a smaller
 * medal rather than spreading them out side by side.
 */
export function BoardPodium({ entries, loading }: { entries: BoardEntry[]; loading: boolean }) {
  const cells = loading
    ? MEDALS.map((m, i) => ({ medal: m, e: null as BoardEntry | null, key: String(i) }))
    : entries.slice(0, 3).map((e, i) => ({ medal: MEDALS[i], e, key: e.root }));
  return (
    <div className="hidden lg:flex border-t border-line">
      {cells.map(({ medal, e, key }) => (
        <div key={key} className="flex-1 flex items-center gap-x-2 min-w-0 py-2 pr-5 border-r border-line last:border-r-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={medal} alt="" width={140} height={140} className="w-24 h-24 shrink-0 -ml-1" />
          {e ? (
            <div className="flex flex-col gap-y-2.5 min-w-0 flex-1">
              <span className="flex items-center gap-x-2.5 min-w-0">
                <ProfileAvatar address={e.root} size={32} ringColor="transparent" />
                <Link
                  href={`/hunter/${e.root}`}
                  className="text-base/none text-heading truncate motion-safe:transition-opacity hover:opacity-80"
                >
                  {nameOrShort(e.username, e.root)}
                </Link>
              </span>
              <span className="text-sm/none text-nav-muted truncate">{e.sub}</span>
              <span className="text-sm/none text-heading tabular-nums truncate">
                {e.value} <span className="text-nav-muted">{e.unit}</span>
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-y-3 min-w-0 flex-1">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-[14px] w-24" />
              <Skeleton className="h-[14px] w-16" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * One board row. Mirrors the leaderboard's RankRow geometry (rank slot, avatar,
 * two text lines, amount) and adds a chevron that reveals `details` underneath.
 */
export function BoardRow({
  e, isMe, open, onToggle, details, className = "",
}: {
  e: BoardEntry; isMe: boolean; open: boolean; onToggle: () => void; details: React.ReactNode; className?: string;
}) {
  const showsMedal = e.rank <= 3 && !isMe;
  return (
    <div className={clsx("border-b border-line last:border-0", isMe && "bg-brand-soft/40", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onToggle(); } }}
        className={clsx("flex justify-between items-center gap-3 pr-4 lg:pr-6 cursor-pointer motion-safe:transition-colors",
          !isMe && "hover:bg-surface/60")}
      >
        <div className="flex items-center min-w-0">
          <div className={clsx("shrink-0", showsMedal ? "p-0 lg:p-5.75" : "p-[17px] lg:p-5.75")}>
            <RankBadge rank={e.rank} highlight={isMe} />
          </div>
          <Identity e={e} />
        </div>
        <div className="flex items-center gap-3 lg:gap-5 shrink-0">
          <Amount e={e} />
          <span
            aria-hidden
            className="w-9 h-9 rounded-full bg-surface flex items-center justify-center text-heading shrink-0"
          >
            {open ? <ChevronUp className="w-4 h-4" strokeWidth={2} /> : <ChevronDown className="w-4 h-4" strokeWidth={2} />}
          </span>
        </div>
      </div>
      {open && <div className="px-4 lg:px-6 pb-5 pt-1 flex flex-col gap-y-4">{details}</div>}
    </div>
  );
}

export function BoardRowSkeleton() {
  return (
    <div className="border-b border-line last:border-0 flex justify-between items-center gap-3 pr-6">
      <div className="flex items-center min-w-0">
        <div className="p-[17px] lg:p-5.75 shrink-0"><Skeleton className="w-11.5 h-11.5" /></div>
        <IdentitySkeleton />
      </div>
      <AmountSkeleton />
    </div>
  );
}

/** Small person pill inside an expanded row (a claimer, an invitee). */
export function PersonPill({ root, username, active, title, mark }: {
  root: string; username: string | null; active: boolean; title?: string; mark?: React.ReactNode;
}) {
  return (
    <Link
      href={`/hunter/${root}`}
      title={title}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full pl-1 pr-3 py-1 text-sm/none motion-safe:transition-colors",
        active ? "bg-brand-soft text-brand hover:bg-brand-soft/70" : "bg-surface text-heading hover:bg-nav-controls",
      )}
    >
      <ProfileAvatar address={root} size={24} ringColor="transparent" />
      <span className="truncate max-w-32">{nameOrShort(username, root)}</span>
      {mark}
    </Link>
  );
}

export function LockedTag({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-1 text-xs/none text-nav-muted whitespace-nowrap shrink-0">
      <Lock className="w-3 h-3" strokeWidth={2} /> {n} to unlock
    </span>
  );
}

/**
 * Your own standing, pinned above the fold — the leaderboard's MeBar with the
 * amount made generic (points on one board, G$ on the other).
 */
export function YouBar({ rank, root, sub, value, unit }: {
  rank: number; root: string; sub: string; value: string; unit: string;
}) {
  return (
    <div
      className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[900] w-[340px] lg:w-100 max-w-[calc(100vw-32px)]
        bg-[#00113866] backdrop-blur-md rounded-full py-2.25 pl-2.25 pr-6
        flex justify-between items-center gap-3 shadow-[0px_0px_12px_0px_#00000014]"
    >
      <div className="flex items-center gap-x-2 min-w-0">
        <RankBadge rank={rank} highlight />
        <button
          type="button"
          onClick={() => openProfile(root, rank)}
          className="flex items-center gap-x-3 min-w-0 text-left cursor-pointer motion-safe:transition-opacity hover:opacity-80"
        >
          <ProfileAvatar address={root} size={38} ringColor="transparent" />
          <span className="flex flex-col gap-y-2.5 min-w-0">
            <span className="text-base/none text-white">You</span>
            <span className="text-sm/none text-white/70 truncate">{sub}</span>
          </span>
        </button>
      </div>
      <div className="flex flex-col gap-y-2.5 items-end shrink-0">
        <span className="text-base/none text-white tabular-nums">{value}</span>
        <span className="text-sm/none text-white/70">{unit}</span>
      </div>
    </div>
  );
}
