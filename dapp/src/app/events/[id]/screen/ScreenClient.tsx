"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Maximize, Minimize } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { UserHandle } from "@/components/UserHandle";
import { useProfiles } from "@/hooks/useProfile";
import { formatG$ } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { MARK_G_TOP, MARK_G_BOTTOM, MARK_DROP, BRAND_SPARK } from "@/lib/brandMark";
import type { EventStatsJson } from "@/lib/events";
import { ago, formatRange, relativeLine, shortG } from "@/components/events/format";
import { useEventDetail, useNowSec } from "@/components/events/useEvents";

const G = 10n ** 18n;
const whole = (wei: string) => Number(BigInt(wei || "0") / G);

/**
 * For a projector or TV at the venue: the numbers big enough to read from the
 * back of the room, finds as they happen, and the door QR so anyone watching
 * can join. Refreshes itself and keeps the screen awake.
 */
export default function ScreenClient({ id }: { id: string }) {
  const { data, notFound } = useEventDetail(id, undefined, 10_000);
  const now = useNowSec(5_000);
  const [origin, setOrigin] = useState("https://www.gooddrops.xyz");
  const [full, setFull] = useState(false);

  useEffect(() => { setOrigin(window.location.origin); track("event_screen_opened"); }, []);

  // Keep the display from sleeping mid-event (where the browser allows it).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const take = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === "visible") lock = await wl.request("screen");
      } catch { /* not allowed here; the screen may dim */ }
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => { document.removeEventListener("visibilitychange", take); lock?.release().catch(() => {}); };
  }, []);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  if (notFound) return <Frame><p className="m-auto text-3xl text-heading">Event not found</p></Frame>;
  if (!data) return <Frame><div className="m-auto w-16 h-16 rounded-full border-4 border-brand/20 border-t-brand animate-spin" aria-label="Loading" /></Frame>;

  const e = data.event;
  const phase = now < e.startsAt ? "upcoming" : now < e.endsAt ? "live" : "ended";
  const cancelled = e.status === "cancelled";
  const joinUrl = `${origin}/events/${e.id}?door=1`;

  return (
    <Frame>
      <header className="flex items-center gap-5">
        <Mark />
        <div className="min-w-0 flex-1">
          <h1 className="text-[clamp(28px,3.6vw,64px)]/[1.05] text-heading truncate">{e.title}</h1>
          <p className="mt-2 text-[clamp(16px,1.5vw,26px)]/none text-nav-muted truncate">
            {e.venueName} · {cancelled ? "Cancelled" : relativeLine(phase, e.startsAt, e.endsAt, now, e.tz)}
          </p>
        </div>
        <button type="button" onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"}
          className="w-12 h-12 shrink-0 rounded-full bg-white text-heading flex items-center justify-center cursor-pointer hover:bg-nav-controls">
          {full ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </button>
      </header>

      <div className="mt-8 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,30%)] gap-6">
        <div className="min-h-0 flex flex-col gap-6">
          <Numbers stats={data.stats} phase={phase} cancelled={cancelled} />
          <Finds stats={data.stats} now={now} phase={phase} />
        </div>
        <aside className="min-h-0 flex flex-col gap-6">
          {!cancelled && phase !== "ended" && (
            <div className="rounded-[32px] bg-white p-6 flex flex-col items-center text-center gap-4">
              <p className="text-[clamp(20px,1.8vw,32px)]/none text-heading">Scan to join the hunt</p>
              <div className="w-full max-w-[320px] aspect-square bg-white">
                <QRCodeSVG value={joinUrl} size={512} level="M" style={{ width: "100%", height: "100%" }} />
              </div>
              <p className="text-[clamp(14px,1.1vw,20px)]/[1.3] text-nav-muted">Sign in, verify once, and find G$ around the venue.</p>
            </div>
          )}
          <Top stats={data.stats} />
        </aside>
      </div>
      <p className="mt-6 text-[clamp(12px,0.9vw,16px)]/none text-nav-muted">
        {formatRange(e.startsAt, e.endsAt, e.tz)} · Numbers come straight from the Celo blockchain · gooddrops.xyz
      </p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-surface font-sans p-[clamp(16px,2.5vw,48px)] flex flex-col">{children}</div>;
}

function Mark() {
  return (
    <span className="w-[clamp(48px,4.5vw,80px)] h-[clamp(48px,4.5vw,80px)] shrink-0 rounded-full bg-brand flex items-center justify-center">
      <svg viewBox="0 0 512 512" className="w-3/5 h-3/5" aria-hidden>
        <path d={MARK_G_TOP} fill="#FFFFFF" /><path d={MARK_G_BOTTOM} fill="#FFFFFF" /><path d={MARK_DROP} fill={BRAND_SPARK} />
      </svg>
    </span>
  );
}

function Numbers({ stats: s, phase, cancelled }: { stats: EventStatsJson; phase: string; cancelled: boolean }) {
  const found = whole(s.claimedWei), hidden = whole(s.liveWei);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Big accent value={big(s.hunters)} label={s.hunters === 1 ? "person found G$" : "people found G$"} />
      <Big value={big(found)} label="G$ found so far" />
      <Big value={cancelled ? "0" : big(hidden)}
        label={cancelled ? "the hunt is off" : phase === "upcoming" ? "G$ waiting to unlock" : phase === "live" ? `G$ still hidden in ${s.live} ${s.live === 1 ? "drop" : "drops"}` : "G$ left unfound"} />
    </div>
  );
}

/** Readable from the back of the room: full below 100k, then 120k / 1.2M. */
const big = (n: number) => (n >= 100_000 ? shortG(n) : n.toLocaleString("en-US"));

function Big({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={`rounded-[32px] p-[clamp(16px,2vw,36px)] min-w-0 ${accent ? "bg-brand text-white" : "bg-white"}`}>
      <p className={`font-anta text-[clamp(36px,4.6vw,96px)]/none truncate ${accent ? "text-white" : "text-heading"}`}>{value}</p>
      <p className={`mt-3 text-[clamp(14px,1.3vw,24px)]/[1.2] ${accent ? "text-white/80" : "text-nav-muted"}`}>{label}</p>
    </div>
  );
}

function Finds({ stats: s, now, phase }: { stats: EventStatsJson; now: number; phase: string }) {
  const addrs = useMemo(() => [...s.recent.map((r) => r.claimer), ...s.topHunters.map((h) => h.address)], [s]);
  useProfiles(addrs);
  // Newest find gets a brief highlight when it arrives.
  const newest = s.recent[0]?.dropId;
  const seen = useRef<string | undefined>(newest);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    if (newest && seen.current && newest !== seen.current) {
      setFresh(newest);
      const t = window.setTimeout(() => setFresh(null), 6000);
      seen.current = newest;
      return () => window.clearTimeout(t);
    }
    seen.current = newest;
  }, [newest]);

  return (
    <section className="flex-1 min-h-0 rounded-[32px] bg-white p-[clamp(16px,2vw,36px)] flex flex-col">
      <h2 className="text-[clamp(18px,1.6vw,30px)]/none text-heading">Latest finds</h2>
      {s.recent.length === 0 ? (
        <p className="mt-5 text-[clamp(16px,1.4vw,26px)]/[1.3] text-nav-muted">
          {phase === "upcoming" ? "The drops unlock when it starts. Finds show up here the moment they happen." : "No finds yet. The first one shows up here."}
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3 overflow-hidden">
          {s.recent.slice(0, 6).map((r) => (
            <li key={r.dropId}
              className={`flex items-center gap-4 rounded-2xl px-4 py-3 motion-safe:transition-colors ${fresh === r.dropId ? "bg-brand-soft" : ""}`}>
              <ProfileAvatar address={r.claimer} size={44} ringColor="transparent" />
              <p className="min-w-0 flex-1 text-[clamp(16px,1.5vw,28px)]/[1.2] text-heading truncate">
                <UserHandle address={r.claimer} /> <span className="text-nav-muted">found</span> {formatG$(BigInt(r.amountWei))} G$
              </p>
              <span className="text-[clamp(13px,1.1vw,20px)]/none text-nav-muted shrink-0">{r.claimedAt ? ago(r.claimedAt, now) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Top({ stats: s }: { stats: EventStatsJson }) {
  if (s.topHunters.length === 0) return null;
  return (
    <section className="rounded-[32px] bg-white p-6">
      <h2 className="text-[clamp(18px,1.5vw,28px)]/none text-heading">Top hunters</h2>
      <ol className="mt-4 flex flex-col gap-3">
        {s.topHunters.map((h, i) => (
          <li key={h.address} className="flex items-center gap-3 min-w-0">
            <span className="w-6 text-center font-anta text-[clamp(14px,1.2vw,22px)] text-nav-muted">{i + 1}</span>
            <ProfileAvatar address={h.address} size={36} ringColor="transparent" />
            <UserHandle address={h.address} className="min-w-0 flex-1 text-[clamp(14px,1.2vw,22px)]/none text-heading truncate" />
            <span className="text-[clamp(14px,1.2vw,22px)]/none text-heading shrink-0">{formatG$(BigInt(h.wei))} G$</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

