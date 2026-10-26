"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, Bell, BellRing, CalendarPlus, Check, Clock, ExternalLink, Loader2, MapPin, Navigation,
  Pencil, Plus, RefreshCw, Share2, XCircle,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { UserHandle } from "@/components/UserHandle";
import { DropGDrawer } from "@/components/drop/DropGDrawer";
import { useAuth } from "@/hooks/useAuth";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useProfiles } from "@/hooks/useProfile";
import { shareOrCopy } from "@/lib/share";
import { track } from "@/lib/analytics";
import { gpsToDeg, formatG$ } from "@/lib/utils";
import { eventIdOf, hostsOf, type GdEvent } from "@/lib/events";
import { fromDropJson, type DropJson } from "@/lib/dropJson";
import { CategoryChip, PhasePill, BudgetBar } from "@/components/events/Pieces";
import { EventForm } from "@/components/events/EventForm";
import { CancelEventSheet } from "@/components/events/CancelEventSheet";
import { buildIcs, downloadIcs } from "@/components/events/ics";
import { ago, formatRange, relativeLine } from "@/components/events/format";
import { useEventDetail, useNowSec } from "@/components/events/useEvents";
import type { EventMapDrop } from "@/components/events/EventMap";

const EventMap = dynamic(() => import("@/components/events/EventMap").then((m) => m.EventMap), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-surface animate-pulse" />,
});

const G = 10n ** 18n;
const g = (wei: string) => Number(BigInt(wei || "0") / G);
const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A]";

export default function EventPageClient({ id }: { id: string }) {
  const { login } = useAuth();
  const { address } = useSignedInAccount();
  const now = useNowSec(15_000);
  const { data, loading, error, notFound, refresh } = useEventDetail(id, address);

  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dropping, setDropping] = useState(false);

  if (notFound) return <Shell><Missing /></Shell>;
  if (loading) return <Shell><PageSkeleton /></Shell>;
  if (error || !data) {
    return (
      <Shell>
        <div className={`${CARD} p-8 flex flex-col items-center text-center gap-4`} role="alert">
          <p className="text-lg/none text-heading">Couldn&apos;t load this event</p>
          <p className="text-sm/[145%] text-nav-muted">Check your connection and try again.</p>
          <button type="button" onClick={refresh} className="h-11 px-6 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer hover:bg-brand/90">
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      </Shell>
    );
  }

  const e = data.event;
  const s = data.stats;
  const phase = now < e.startsAt ? "upcoming" : now < e.endsAt ? "live" : "ended";
  const cancelled = e.status === "cancelled";
  const isOrganizer = data.viewer.isOrganizer;
  const isHost = data.viewer.isHost;
  const canAddDrops = isHost && e.status === "approved" && phase !== "ended";

  return (
    <Shell>
      <Link href="/events" className="inline-flex items-center gap-2 h-10 pr-3 text-sm/none text-nav-muted hover:text-heading mb-4">
        <ArrowLeft className="w-4 h-4" /> All events
      </Link>

      {isHost && <HostBanner event={e} />}
      {cancelled && (
        <div className="mb-5 rounded-3xl bg-danger/10 text-danger px-5 py-4 text-sm/[145%]" role="status">
          This event was cancelled. {now < e.startsAt ? "Its drops stay locked." : ""}
        </div>
      )}

      {/* Phones read top to bottom: what it is → what to do → the numbers.
          On desktop the actions sit in a sticky side column instead. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] gap-5 lg:gap-x-8 items-start">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <section className={`${CARD} p-6 lg:p-8`}>
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryChip category={e.category} />
              <PhasePill phase={phase} cancelled={cancelled} />
              {!cancelled && <span className="text-sm/none text-nav-muted">{relativeLine(phase, e.startsAt, e.endsAt, now)}</span>}
            </div>
            <h1 className="mt-5 text-[28px]/[1.15] lg:text-[40px]/[1.1] text-heading break-words">{e.title}</h1>
            <div className="mt-5 flex flex-col gap-3 text-base/[1.35] text-heading">
              <span className="flex items-start gap-3"><Clock className="w-5 h-5 shrink-0 mt-0.5 text-nav-muted" strokeWidth={1.75} />{formatRange(e.startsAt, e.endsAt)}</span>
              <span className="flex items-start gap-3">
                <MapPin className="w-5 h-5 shrink-0 mt-0.5 text-nav-muted" strokeWidth={1.75} />
                <span className="min-w-0">
                  {e.venueName}
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}`} target="_blank" rel="noopener noreferrer"
                    className="ml-2 inline-flex items-center gap-1 text-sm text-brand hover:underline">
                    Directions <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </span>
              </span>
            </div>
            <Hosts event={e} />
            {e.description && <p className="mt-6 text-base/[1.55] text-heading whitespace-pre-line break-words">{e.description}</p>}
            {e.link && (
              <a href={e.link} target="_blank" rel="noopener noreferrer nofollow ugc"
                className="mt-5 inline-flex items-center gap-2 h-11 px-5 rounded-full border border-line text-sm/none text-heading hover:bg-surface max-w-full">
                <ExternalLink className="w-4 h-4 shrink-0" /> <span className="truncate">{new URL(e.link).hostname.replace(/^www\./, "")}</span>
              </a>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5 min-w-0 lg:col-start-1 lg:row-start-2">
          <LiveStats event={e} stats={s} interested={data.interested} phase={phase} cancelled={cancelled} />

          <MapSection event={e} phase={phase} live={s.live} cancelled={cancelled} />

          <Activity stats={s} now={now} />
        </div>

        {/* ── Side column ─────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-5 row-start-2 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start lg:sticky lg:top-[calc(var(--spacing-nav)+24px)]">
          <ActionsCard
            event={e} phase={phase} cancelled={cancelled} interestedCount={data.interested}
            viewerInterested={data.viewer.interested} address={address} onSignIn={login} onChanged={refresh}
          />
          {isHost && (
            <section className={`${CARD} p-6 flex flex-col gap-3`}>
              <h2 className="text-lg/none text-heading">Manage</h2>
              <button type="button" disabled={!canAddDrops} onClick={() => setDropping(true)}
                className="h-12 rounded-full bg-brand text-white text-sm/none flex items-center justify-center gap-2 cursor-pointer hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed">
                <Plus className="w-4 h-4" /> Add drops
              </button>
              <p className="text-xs/[145%] text-nav-muted">
                {e.status !== "approved"
                  ? "You can add drops once the event is approved."
                  : phase === "ended" ? "This event has ended."
                  : phase === "upcoming" ? "Drops you add now stay hidden and locked until the event starts."
                  : "Drops you add go live right away."}
              </p>
              {isOrganizer && !cancelled && phase !== "ended" && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button type="button" onClick={() => setEditing(true)} className="h-11 rounded-full border border-line text-sm/none text-heading flex items-center justify-center gap-1.5 cursor-pointer hover:bg-surface">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button type="button" onClick={() => setCancelling(true)} className="h-11 rounded-full border border-line text-sm/none text-danger flex items-center justify-center gap-1.5 cursor-pointer hover:bg-danger/5">
                    <XCircle className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              )}
              {e.status === "approved" && !cancelled && (
                <div className="mt-2 rounded-2xl border border-line p-4 flex items-center gap-4">
                  <div className="shrink-0 bg-white p-1.5 rounded-xl border border-line">
                    <QRCodeSVG value={`${typeof window !== "undefined" ? window.location.origin : "https://www.gooddrops.xyz"}/events/${e.id}`} size={72} level="M" />
                  </div>
                  <p className="text-xs/[145%] text-nav-muted">Put this QR up at the venue so people can open the event and follow the hunt.</p>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>

      {editing && address && (
        <EventForm address={address} event={e} onClose={() => { setEditing(false); refresh(); }} onSaved={() => refresh()} />
      )}
      {cancelling && address && (
        <CancelEventSheet event={e} address={address} onClose={() => setCancelling(false)} onCancelled={() => refresh()} />
      )}
      {dropping && (
        <DropGDrawer
          userLocation={null}
          eventId={e.id}
          eventName={e.title}
          eventVenue={{ lat: e.lat, lng: e.lng, name: e.venueName }}
          onClose={() => setDropping(false)}
          onSuccess={() => refresh()}
        />
      )}
    </Shell>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <main className="pt-nav">
        <div className="px-4 lg:px-15 pt-6 lg:pt-8 pb-24">{children}</div>
      </main>
    </div>
  );
}

function Missing() {
  return (
    <div className={`${CARD} p-8 lg:p-10 max-w-[520px] mx-auto mt-10 flex flex-col items-center text-center gap-4`}>
      <p className="text-xl/none text-heading">Event not found</p>
      <p className="text-sm/[150%] text-nav-muted">It may still be in review, or the link is wrong.</p>
      <Link href="/events" className="h-12 px-6 rounded-full bg-brand text-white text-sm/none flex items-center hover:bg-brand/90">See all events</Link>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 lg:gap-8" aria-busy>
      <div className="flex flex-col gap-5">
        <div className={`${CARD} p-8 flex flex-col gap-4`}>
          <Skeleton className="h-8 w-48" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-2/5" />
        </div>
        <div className={`${CARD} p-6 grid grid-cols-2 lg:grid-cols-3 gap-3`}>
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      </div>
      <div className={`${CARD} p-6 flex flex-col gap-3`}><Skeleton className="h-10 w-2/3" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
    </div>
  );
}

function HostBanner({ event: e }: { event: GdEvent }) {
  if (e.status === "pending") {
    return <Banner tone="warn">In review. Only you and your co-hosts can see this page until it&apos;s approved. We&apos;ll notify you.</Banner>;
  }
  if (e.status === "rejected") {
    return <Banner tone="danger">{e.rejectReason?.startsWith("Removed") ? e.rejectReason : `Needs changes: ${e.rejectReason ?? "see the reviewer's note"}`} Edit it and resubmit from Your events.</Banner>;
  }
  if (e.status === "approved" && e.pendingEdit) {
    return <Banner tone="warn">Your changes are in review. Everyone sees the current version until they&apos;re approved.</Banner>;
  }
  if (e.status === "approved" && e.rejectReason?.startsWith("Edit not approved")) {
    return <Banner tone="warn">{e.rejectReason}</Banner>;
  }
  return null;
}

function Banner({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div className={`mb-5 rounded-3xl px-5 py-4 text-sm/[145%] ${tone === "danger" ? "bg-danger/10 text-danger" : "bg-streak-bg text-heading"}`} role="status">
      {children}
    </div>
  );
}

function Hosts({ event: e }: { event: GdEvent }) {
  return (
    <div className="mt-6 flex items-center gap-3 flex-wrap">
      <Link href={`/hunter/${e.organizer}`} className="flex items-center gap-3 min-w-0 rounded-full pr-2 hover:bg-surface">
        <ProfileAvatar address={e.organizer} size={36} ringColor="transparent" />
        <span className="flex flex-col gap-1 min-w-0">
          <span className="text-xs/none text-nav-muted">Hosted by</span>
          <UserHandle address={e.organizer} className="text-sm/none text-heading truncate" />
        </span>
      </Link>
      {e.cohosts.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex">
            {e.cohosts.slice(0, 4).map((a, i) => (
              <span key={a} className={`rounded-full ring-2 ring-white ${i ? "-ml-2" : ""}`}><ProfileAvatar address={a} size={28} ringColor="transparent" /></span>
            ))}
          </div>
          <span className="text-xs/none text-nav-muted">+ {e.cohosts.length} co-host{e.cohosts.length === 1 ? "" : "s"}</span>
        </div>
      )}
    </div>
  );
}

function LiveStats({ event: e, stats: s, interested, phase, cancelled }: {
  event: GdEvent; stats: import("@/lib/events").EventStatsJson; interested: number; phase: "upcoming" | "live" | "ended"; cancelled: boolean;
}) {
  const dropped = g(s.droppedWei), claimed = g(s.claimedWei), hidden = g(s.liveWei);
  const usedPct = e.budgetG > 0 ? Math.min(999, Math.round((dropped / e.budgetG) * 100)) : 0;
  const headline =
    cancelled ? "Final numbers"
    : phase === "upcoming" ? "Drops unlock when it starts"
    : phase === "live" ? `Hunt now · ${s.live} ${s.live === 1 ? "drop" : "drops"} live`
    : "This event has ended";
  return (
    <section className={`${CARD} p-6`} aria-labelledby="stats-h">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <h2 id="stats-h" className="text-lg/none text-heading">{headline}</h2>
        {phase === "live" && !cancelled && (
          <span className="inline-flex items-center gap-1.5 text-xs/none text-nav-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-brand motion-safe:animate-pulse" /> Updates live
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile value={s.hunters.toLocaleString()} label={s.hunters === 1 ? "person found G$" : "people found G$"} accent />
        <Tile value={`${s.claims.toLocaleString()}`} label={`of ${s.drops.toLocaleString()} drops claimed`} />
        <Tile value={`${claimed.toLocaleString()} G$`} label="G$ circulated" />
        <Tile value={`${hidden.toLocaleString()} G$`} label={cancelled ? "locked by the cancellation" : phase === "upcoming" ? "waiting to unlock" : phase === "live" ? "still hidden" : "left unclaimed"} />
        <Tile value={`${usedPct}%`} label={`of ${e.budgetG.toLocaleString()} G$ budget dropped`} />
        <Tile value={interested.toLocaleString()} label="interested" />
      </div>
      <BudgetBar className="mt-5" budgetG={e.budgetG} droppedG={dropped} claimedG={claimed} />
      <p className="mt-2 text-xs/[145%] text-nav-muted">
        {dropped.toLocaleString()} of {e.budgetG.toLocaleString()} G$ dropped · {claimed.toLocaleString()} found. Numbers come straight from the chain.
      </p>
    </section>
  );
}

function Tile({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 min-w-0 ${accent ? "bg-brand text-white" : "bg-surface"}`}>
      <p className={`font-anta text-[26px]/none truncate ${accent ? "text-white" : "text-heading"}`}>{value}</p>
      <p className={`mt-2 text-xs/[1.3] ${accent ? "text-white/80" : "text-nav-muted"}`}>{label}</p>
    </div>
  );
}

function Activity({ stats: s, now }: { stats: import("@/lib/events").EventStatsJson; now: number }) {
  const addrs = useMemo(() => [...s.recent.map((r) => r.claimer), ...s.topHunters.map((h) => h.address)], [s]);
  useProfiles(addrs); // one batched lookup for every handle below
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <section className={`${CARD} p-6`} aria-labelledby="recent-h">
        <h2 id="recent-h" className="text-lg/none text-heading mb-4">Recent finds</h2>
        {s.recent.length === 0 ? (
          <p className="text-sm/[145%] text-nav-muted">No finds yet. The first one shows up here the moment it happens.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {s.recent.slice(0, 8).map((r) => (
              <li key={r.dropId} className="flex items-center gap-3 min-w-0">
                <ProfileAvatar address={r.claimer} size={32} ringColor="transparent" />
                <p className="min-w-0 flex-1 text-sm/[1.35] text-heading truncate">
                  <UserHandle address={r.claimer} /> <span className="text-nav-muted">found</span> {formatG$(BigInt(r.amountWei))} G$
                </p>
                <span className="text-xs/none text-nav-muted shrink-0">{r.claimedAt ? ago(r.claimedAt, now) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={`${CARD} p-6`} aria-labelledby="top-h">
        <h2 id="top-h" className="text-lg/none text-heading mb-4">Top hunters</h2>
        {s.topHunters.length === 0 ? (
          <p className="text-sm/[145%] text-nav-muted">Nobody yet. Be the first.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {s.topHunters.map((h, i) => (
              <li key={h.address} className="flex items-center gap-3 min-w-0">
                <span className="w-6 text-center font-anta text-sm text-nav-muted">{i + 1}</span>
                <ProfileAvatar address={h.address} size={32} ringColor="transparent" />
                <Link href={`/hunter/${h.address}`} className="min-w-0 flex-1 text-sm/none text-heading truncate hover:text-brand">
                  <UserHandle address={h.address} />
                </Link>
                <span className="text-sm/none text-heading shrink-0">{formatG$(BigInt(h.wei))} G$</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ActionsCard({ event: e, phase, cancelled, interestedCount, viewerInterested, address, onSignIn, onChanged }: {
  event: GdEvent; phase: "upcoming" | "live" | "ended"; cancelled: boolean; interestedCount: number; viewerInterested: boolean;
  address: string | undefined; onSignIn: () => void; onChanged: () => void;
}) {
  const push = usePushSubscription();
  const [on, setOn] = useState(viewerInterested);
  const [count, setCount] = useState(interestedCount);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [shared, setShared] = useState(false);
  useEffect(() => { setOn(viewerInterested); setCount(interestedCount); }, [viewerInterested, interestedCount]);

  async function toggleRemind() {
    if (!address) { onSignIn(); return; }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/events/${e.id}/interest`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, on: !on }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(body.error ?? "Couldn't update. Try again."); return; }
      setOn(body.on); setCount(body.interested);
      if (body.on) track("event_reminder_on");
      onChanged();
    } catch { setMsg("Couldn't update. Try again."); }
    finally { setBusy(false); }
  }

  const url = typeof window !== "undefined" ? `${window.location.origin}/events/${e.id}` : `https://www.gooddrops.xyz/events/${e.id}`;
  async function share() {
    const r = await shareOrCopy({ title: e.title, text: `${e.title} · ${e.budgetG.toLocaleString()} G$ of drops to find on GoodDrops`, url });
    if (r === "shared" || r === "copied") track("event_shared");
    if (r === "copied") { setShared(true); setTimeout(() => setShared(false), 1800); }
  }
  function calendar() {
    downloadIcs(`${e.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "event"}.ics`, buildIcs({ ...e, url }));
    track("event_calendar_added");
  }

  const open = !cancelled && phase !== "ended";
  const pushOff = on && push.status !== "subscribed";

  return (
    <section className={`${CARD} p-6 flex flex-col gap-3`}>
      <div className="flex items-baseline gap-2">
        <span className="font-anta text-[34px]/none text-heading">{e.budgetG.toLocaleString()}</span>
        <span className="text-brand text-xl">G$</span>
        <span className="text-sm text-nav-muted">to find</span>
      </div>
      {open && (
        <>
          <button type="button" onClick={toggleRemind} disabled={busy} aria-pressed={on}
            className={`h-12 rounded-full text-sm/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors disabled:opacity-60
              ${on ? "bg-brand-soft text-brand" : "bg-brand text-white hover:bg-brand/90"}`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            {!address ? "Sign in to get a reminder" : on ? "Reminder on" : "Remind me"}
          </button>
          <p className="text-xs/[145%] text-nav-muted text-center">
            {count.toLocaleString()} interested{on ? " · we'll ping you about an hour before it starts" : ""}
          </p>
          {pushOff && push.status !== "unsupported" && push.status !== "denied" && (
            <button type="button" onClick={() => push.subscribe()}
              className="h-11 rounded-full border border-line text-sm/none text-heading flex items-center justify-center gap-2 cursor-pointer hover:bg-surface">
              <Bell className="w-4 h-4" /> Turn on notifications so the reminder reaches you
            </button>
          )}
          {pushOff && push.status === "denied" && (
            <p className="text-xs/[145%] text-danger text-center">Notifications are blocked for this site, so the reminder can&apos;t reach you. Allow them in your browser settings.</p>
          )}
          {pushOff && push.status === "unsupported" && (
            <p className="text-xs/[145%] text-nav-muted text-center">On iPhone, add GoodDrops to your Home Screen to get reminders.</p>
          )}
          {msg && <p className="text-xs/none text-danger text-center" role="alert">{msg}</p>}
        </>
      )}
      <div className={`grid gap-2.5 ${open ? "grid-cols-2" : "grid-cols-1"}`}>
        <button type="button" onClick={share}
          className="h-11 rounded-full border border-line text-sm/none text-heading flex items-center justify-center gap-2 cursor-pointer hover:bg-surface">
          {shared ? <><Check className="w-4 h-4 text-brand" /> Link copied</> : <><Share2 className="w-4 h-4" /> Share</>}
        </button>
        {open && (
          <button type="button" onClick={calendar}
            className="h-11 rounded-full border border-line text-sm/none text-heading flex items-center justify-center gap-2 cursor-pointer hover:bg-surface">
            <CalendarPlus className="w-4 h-4" /> Calendar
          </button>
        )}
      </div>
    </section>
  );
}

function MapSection({ event: e, phase, live, cancelled }: { event: GdEvent; phase: "upcoming" | "live" | "ended"; live: number; cancelled: boolean }) {
  const drops = useEventDrops(e, phase);
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="h-[260px] lg:h-[320px]">
        <EventMap venue={{ lat: e.lat, lng: e.lng, name: e.venueName }} drops={drops} />
      </div>
      <div className="p-5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm/[145%] text-nav-muted">
          {cancelled ? "This event was cancelled, so its drops are off the map." : phase === "upcoming" ? "Drops appear on the map when it starts." : phase === "live" ? `${live} ${live === 1 ? "drop is" : "drops are"} live around the venue.` : "The hunt is over."}
        </p>
        {phase === "live" && !cancelled && (
          <Link href={`/?focus=${e.lat},${e.lng}`} className="h-11 px-5 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 hover:bg-brand/90">
            <Navigation className="w-4 h-4" /> Hunt on the map
          </Link>
        )}
      </div>
    </section>
  );
}

/** This event's live drops (by its hosts), for the map. Not shown before the start. */
function useEventDrops(e: GdEvent, phase: "upcoming" | "live" | "ended"): EventMapDrop[] {
  const [drops, setDrops] = useState<EventMapDrop[]>([]);
  const hostKey = [e.organizer, ...e.cohosts].join(",");
  useEffect(() => {
    if (phase !== "live") { setDrops([]); return; }
    let alive = true;
    const hosts = hostsOf(e);
    const load = () => fetch("/api/drops/live").then((r) => r.json()).then((d: { drops?: DropJson[] }) => {
      if (!alive || !Array.isArray(d.drops)) return;
      setDrops(d.drops.map(fromDropJson)
        .filter((x) => eventIdOf(x.hint) === e.id && hosts.has(x.dropper.toLowerCase()))
        .map((x) => ({ lat: gpsToDeg(x.lat), lng: gpsToDeg(x.lng), amount: formatG$(x.amount) })));
    }).catch(() => {});
    load();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => { alive = false; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, hostKey, phase]);
  return drops;
}
