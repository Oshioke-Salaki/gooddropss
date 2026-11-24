"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, ChevronDown, ChevronUp, Copy, Lock, RefreshCw, Timer, Users,
} from "lucide-react";
import clsx from "clsx";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { ordinal } from "@/app/leaderboard/components/RankBadge";
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

/** Gold, silver, bronze: the rank badge on each podium avatar. */
const PODIUM_TONES = ["bg-[#F5B83D] text-white", "bg-[#AEB6C2] text-white", "bg-[#C8834F] text-white"];
/** Rows shown at first (the podium counts as three), and how many each "Show more" adds. */
const FIRST = 10;
const STEP = 20;

// ── Podium ────────────────────────────────────────────────────────────────────

/**
 * The top three as cards, at every width: second, first, third, with first
 * raised and filled. Tapping one opens their details under the podium.
 */
function Podium({ entries, meRoot, open, onOpen }: {
  entries: BoardEntry[]; meRoot: string | null; open: string | null; onOpen: (root: string) => void;
}) {
  const order = [entries[1], entries[0], entries[2]];
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3 items-end px-4 lg:px-6 pt-2">
      {order.map((e) => {
        const first = e.rank === 1;
        const selected = open === e.root;
        return (
          <button
            key={e.root}
            type="button"
            onClick={() => onOpen(e.root)}
            aria-expanded={selected}
            aria-label={`${ordinal(e.rank)}: ${nameOrShort(e.username, e.root)}, ${e.value} ${e.unit}`}
            className={clsx(
              "relative min-w-0 rounded-2xl sm:rounded-3xl flex flex-col items-center text-center cursor-pointer",
              "px-2 sm:px-3 motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 hover:-translate-y-0.5",
              first ? "bg-brand text-white pt-5 pb-4 sm:pt-6 sm:pb-5" : "bg-surface text-heading pt-4 pb-3.5 sm:pt-5 sm:pb-4",
              selected && (first ? "ring-2 ring-offset-2 ring-brand" : "ring-2 ring-brand"),
            )}
          >
            <span className="relative">
              <ProfileAvatar address={e.root} size={first ? 60 : 48} ringColor="transparent" />
              <span aria-hidden className={clsx(
                "absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center font-anta text-xs/none",
                "ring-[3px]", first ? "ring-brand" : "ring-surface", PODIUM_TONES[e.rank - 1],
              )}>
                {e.rank}
              </span>
            </span>
            <span className={clsx("mt-3.5 w-full truncate text-sm/none sm:text-base/none", first ? "text-white" : "text-heading")}>
              {meRoot === e.root ? "You" : nameOrShort(e.username, e.root)}
            </span>
            <span className={clsx("mt-2 w-full truncate tabular-nums text-sm/none", first ? "text-white" : "text-heading")}>
              {e.value} <span className={first ? "text-white/70" : "text-nav-muted"}>{e.unit}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PodiumSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3 items-end px-4 lg:px-6 pt-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className={clsx("!rounded-2xl sm:!rounded-3xl", i === 1 ? "h-[150px] sm:h-[160px]" : "h-[128px] sm:h-[136px]")} />
      ))}
    </div>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────────────

/** One compact row: rank, avatar, name over a single detail line, value, chevron. */
function Row({ e, isMe, open, onToggle, details, pinned = false }: {
  e: BoardEntry; isMe: boolean; open: boolean; onToggle: () => void; details: React.ReactNode; pinned?: boolean;
}) {
  return (
    <div className={clsx(
      "border-t border-line first:border-t-0",
      isMe && "bg-brand-soft",
      pinned && "sticky bottom-0 z-10 shadow-[0_-8px_24px_-12px_#00000026]",
    )}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onToggle(); } }}
        className={clsx("flex items-center gap-3 px-4 lg:px-6 h-16 cursor-pointer motion-safe:transition-colors",
          !isMe && "hover:bg-surface/70")}
      >
        <span className={clsx("w-7 shrink-0 text-center font-anta text-sm/none tabular-nums",
          isMe ? "text-brand" : "text-nav-muted")}>
          {e.rank}
        </span>
        <ProfileAvatar address={e.root} size={36} ringColor="transparent" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href={`/hunter/${e.root}`}
              onClick={(ev) => ev.stopPropagation()}
              className="text-[15px]/none text-heading truncate motion-safe:transition-opacity hover:opacity-70"
            >
              {nameOrShort(e.username, e.root)}
            </Link>
            {isMe && <span className="shrink-0 rounded-full bg-brand text-white px-2 py-1 text-[11px]/none">You</span>}
            {e.tags}
          </div>
          <p className="mt-1.5 text-xs/none text-nav-muted truncate">{e.sub}</p>
        </div>
        <p className="shrink-0 text-right tabular-nums whitespace-nowrap">
          <span className="text-[15px]/none text-heading">{e.value}</span>
          <span className="text-xs/none text-nav-muted"> {e.unit}</span>
        </p>
        <ChevronDown aria-hidden strokeWidth={2}
          className={clsx("w-4 h-4 shrink-0 text-nav-muted motion-safe:transition-transform", open && "rotate-180")} />
      </div>
      {open && <div className="px-4 lg:px-6 pb-5 pt-1 flex flex-col gap-y-4 lg:pl-[88px]">{details}</div>}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="border-t border-line first:border-t-0 flex items-center gap-3 px-4 lg:px-6 h-16">
      <Skeleton className="w-6 h-3.5" />
      <Skeleton className="w-9 h-9 rounded-full" />
      <div className="flex-1 flex flex-col gap-y-2"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-40 max-w-full" /></div>
      <Skeleton className="h-3.5 w-14" />
    </div>
  );
}

export function BoardListSkeleton() {
  return (
    <>
      <PodiumSkeleton />
      <div className="mt-4 border-t border-line">{Array.from({ length: 7 }, (_, i) => <RowSkeleton key={i} />)}</div>
    </>
  );
}

/**
 * The whole board body: podium, the first rows, "Show more" in steps, and
 * your own row kept in view. Long boards stay short by default (top ten), and
 * nobody has to scroll a hundred rows to find themselves: when you're further
 * down, your row sits under the list and stays pinned to the bottom of the
 * screen while the board is on it.
 */
export function BoardList({ entries, meRoot, details, anchorId }: {
  entries: BoardEntry[];
  meRoot: string | null;
  details: (root: string) => React.ReactNode;
  /** Scrolled back into view when the list collapses. */
  anchorId: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const hasPodium = entries.length >= 3;
  const podium = hasPodium ? entries.slice(0, 3) : [];
  const rest = hasPodium ? entries.slice(3) : entries;
  const first = hasPodium ? FIRST - 3 : FIRST;
  const [shown, setShown] = useState(first);

  const visible = rest.slice(0, shown);
  const meIndex = meRoot ? rest.findIndex((e) => e.root === meRoot) : -1;
  const meBelow = meIndex >= shown ? rest[meIndex] : null;
  const toggle = (root: string) => setOpen((o) => (o === root ? null : root));
  const podiumOpen = podium.find((e) => e.root === open) ?? null;
  const total = entries.length;
  const showing = Math.min(total, podium.length + shown);

  const collapse = () => {
    setShown(first);
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      {hasPodium && <Podium entries={podium} meRoot={meRoot} open={open} onOpen={toggle} />}
      {podiumOpen && (
        <div className="mx-4 lg:mx-6 mt-3 rounded-2xl bg-surface p-4 flex flex-col gap-y-4">
          <p className="text-sm/none text-heading">
            {ordinal(podiumOpen.rank)} · {nameOrShort(podiumOpen.username, podiumOpen.root)}
            <span className="text-nav-muted"> · {podiumOpen.sub}</span>
          </p>
          {details(podiumOpen.root)}
        </div>
      )}

      {rest.length > 0 && (
        <div className={clsx(hasPodium && "mt-4", "border-t border-line")}>
          {visible.map((e) => (
            <Row key={e.root} e={e} isMe={e.root === meRoot} open={open === e.root} onToggle={() => toggle(e.root)} details={details(e.root)} />
          ))}
          {meBelow && (
            <>
              <div aria-hidden className="border-t border-line h-6 flex items-center justify-center gap-1">
                {[0, 1, 2].map((i) => <span key={i} className="w-1 h-1 rounded-full bg-nav-muted/40" />)}
              </div>
              <Row e={meBelow} isMe pinned open={open === meBelow.root} onToggle={() => toggle(meBelow.root)} details={details(meBelow.root)} />
            </>
          )}
        </div>
      )}

      {/* Footer: where you are in the list, and the controls. */}
      {total > FIRST && (
        <div className="border-t border-line px-4 lg:px-6 py-4 flex items-center justify-between gap-3">
          <span className="text-sm/none text-nav-muted">
            Top <span className="text-heading tabular-nums">{showing}</span> of <span className="tabular-nums">{total.toLocaleString("en-US")}</span>
          </span>
          <div className="flex items-center gap-2">
            {shown > first && (
              <button type="button" onClick={collapse}
                className="h-10 px-4 rounded-full text-sm/none text-nav-muted cursor-pointer motion-safe:transition-colors hover:text-heading hover:bg-surface">
                Show less
              </button>
            )}
            {shown < rest.length && (
              <button type="button" onClick={() => setShown((n) => n + STEP)}
                className="h-10 px-5 rounded-full bg-surface text-sm/none text-heading cursor-pointer motion-safe:transition-colors hover:bg-nav-controls">
                Show {Math.min(STEP, rest.length - shown)} more
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Desktop sidebar that stays in view while the board scrolls. A sidebar taller
 * than the screen scrolls with the page until its end is showing, then holds,
 * so nothing in it is ever out of reach.
 */
export function StickyAside({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(96);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nav = 72 + 24;
    const place = () => setTop(Math.min(nav, window.innerHeight - el.offsetHeight - 24));
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => { ro.disconnect(); window.removeEventListener("resize", place); };
  }, []);
  return (
    <div ref={ref} className={clsx("lg:sticky", className)} style={{ top }}>
      {children}
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
