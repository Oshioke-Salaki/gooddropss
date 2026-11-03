"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ExternalLink, Megaphone, Volume2, VolumeX, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { UserHandle } from "@/components/UserHandle";
import { formatG$ } from "@/lib/utils";
import type { Spot, SpotPayment } from "@/types";

const POLL_MS = 4_000;
const SOUND_KEY = "gd:till:sound";

/** Local midnight, unix seconds. "Today" is the shop's day, not UTC's. */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A short two-note chime, made on the fly: no audio file to download. */
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (const [i, f] of [880, 1320].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.14);
    g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.14 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start(t + i * 0.14);
    o.stop(t + i * 0.14 + 0.4);
  }
}

/**
 * The counter screen. Shows G$ arriving in the shop's wallet within seconds,
 * read from the chain (not from the customer's phone), with a chime and a buzz,
 * so the owner can confirm a payment at a glance before handing over the goods.
 */
export function ShopTill({ spot, onClose }: { spot: Spot; onClose: () => void }) {
  const [payments, setPayments] = useState<SpotPayment[] | null>(null);
  const [error, setError] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);   // tx of the payment that just arrived
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
  });
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  // Opening the till is a tap, which is what lets the browser play sound later.
  useEffect(() => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) audio.current = new AC();
    } catch { /* no sound on this device */ }
    return () => { audio.current?.close().catch(() => {}); };
  }, []);

  // One poll at a time, and only the newest answer counts: a slow reply that
  // lands after a newer one must not make a payment vanish and "arrive" again.
  const inFlight = useRef(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const mine = ++seq.current;
    try {
      const r = await fetch(`/api/spots/${spot.id}/payments?sync=1`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (mine !== seq.current) return;
      const list: SpotPayment[] = (Array.isArray(d.payments) ? d.payments : [])
        .slice().sort((a: SpotPayment, b: SpotPayment) => b.ts - a.ts);
      // The first load is history; anything new after that is a live payment.
      if (seen.current) {
        const arrived = list.filter((p) => !seen.current!.has(p.tx));
        if (arrived.length > 0) {
          setFresh(arrived[0].tx);
          navigator.vibrate?.([60, 60, 60]);
          if (soundRef.current && audio.current) {
            audio.current.resume().then(() => chime(audio.current!)).catch(() => {});
          }
        }
      }
      // Remember every payment ever shown, so none can chime twice.
      if (!seen.current) seen.current = new Set();
      for (const p of list) seen.current.add(p.tx);
      setPayments(list);
      setError(false);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
    }
  }, [spot.id]);

  useEffect(() => {
    load();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const tick = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(poll); window.clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // Let the highlight fade after a while so the next payment stands out too.
  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => setFresh(null), 20_000);
    return () => window.clearTimeout(t);
  }, [fresh]);

  const today = useMemo(() => {
    const from = startOfToday();
    const list = (payments ?? []).filter((p) => p.ts >= from);
    return { list, total: list.reduce((s, p) => s + BigInt(p.amount), 0n) };
  }, [payments, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = payments?.[0] ?? null;
  const highlight = latest && fresh === latest.tx ? latest : null;

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* private mode */ }
    if (next && audio.current) audio.current.resume().then(() => chime(audio.current!)).catch(() => {});
  }

  return (
    <Sheet
      title="Till"
      onClose={onClose}
      width={480}
      headerAction={
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={toggleSound} aria-pressed={sound}
            aria-label={sound ? "Turn payment sound off" : "Turn payment sound on"}
            className="h-8 pl-2.5 pr-3 rounded-full bg-surface text-sm/none text-heading flex items-center gap-1.5 cursor-pointer hover:opacity-80">
            {sound ? <Volume2 className="w-4 h-4" strokeWidth={1.75} /> : <VolumeX className="w-4 h-4" strokeWidth={1.75} />}
            {sound ? "Sound on" : "Sound off"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-full bg-surface text-black cursor-pointer motion-safe:transition-opacity hover:opacity-80">
            <X className="w-5 h-5" />
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-y-5 pt-6">
        <p className="text-sm/none text-nav-muted truncate">{spot.name}</p>

        {/* The moment a payment lands */}
        <div
          role="status"
          aria-live="assertive"
          className={`rounded-3xl p-6 flex flex-col items-center text-center gap-y-3 motion-safe:transition-colors
            ${highlight ? "bg-brand text-white" : "bg-surface text-heading"}`}
        >
          {highlight ? (
            <>
              <span className="success-pop w-14 h-14 rounded-full bg-white/15 flex items-center justify-center">
                <ArrowDownLeft className="w-7 h-7" strokeWidth={2} />
              </span>
              <p className="text-base/none text-white/80">Payment received</p>
              <p className="text-[44px]/none tabular-nums">{formatG$(BigInt(highlight.amount))} <span className="text-xl/none">G$</span></p>
              <p className="text-sm/none text-white/80">
                from <UserHandle address={highlight.payer} /> · {ago(highlight.ts, now)}
              </p>
              <p className="rounded-full bg-white/15 px-3 py-2 text-xs/none tracking-[0.12em] tabular-nums">
                REF {highlight.tx.slice(-6).toUpperCase()}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm/none text-nav-muted">Today</p>
              <p className="text-[44px]/none tabular-nums">{formatG$(today.total)} <span className="text-xl/none text-nav-muted">G$</span></p>
              <p className="text-sm/none text-nav-muted">
                {payments === null ? "Loading…" : today.list.length === 1 ? "1 payment" : `${today.list.length} payments`}
              </p>
            </>
          )}
        </div>

        <p className="text-xs/[145%] text-nav-muted text-center -mt-2">
          {error ? "Can't reach the network. Retrying…"
            : highlight ? `Today: ${formatG$(today.total)} G$ from ${today.list.length} ${today.list.length === 1 ? "payment" : "payments"}`
            : "Watching your wallet. New payments appear here within seconds."}
        </p>

        {/* Today's payments */}
        {payments !== null && today.list.length === 0 ? (
          <div className="rounded-3xl border border-line p-5 flex flex-col items-center text-center gap-y-3">
            <p className="text-base/none text-heading">No payments yet today</p>
            <p className="text-sm/[145%] text-nav-muted max-w-[320px]">
              Customers pay from the GoodDrops map when they&apos;re at your shop. Keep this open and you&apos;ll hear each one.
            </p>
            <a href={`/shop/${spot.id}/poster`} target="_blank" rel="noopener noreferrer"
              className="mt-1 h-11 px-5 rounded-full border border-line text-sm/none text-heading flex items-center gap-2 hover:bg-surface">
              <Megaphone className="w-4 h-4" strokeWidth={1.75} /> Print your pay-here poster
            </a>
          </div>
        ) : (
          <ul className="flex flex-col gap-y-2" aria-label="Today's payments">
            {today.list.slice(0, 30).map((p) => (
              <li key={p.tx}>
                <a href={`https://celoscan.io/tx/${p.tx}`} target="_blank" rel="noopener noreferrer"
                  className={`flex items-center gap-3 rounded-full border p-2 pr-4 min-w-0 hover:bg-surface
                    ${p.tx === fresh ? "border-brand" : "border-line"}`}>
                  <span className="w-10 h-10 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center">
                    <ArrowDownLeft className="w-5 h-5" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-y-1">
                    <span className="text-base/none text-heading tabular-nums">{formatG$(BigInt(p.amount))} G$</span>
                    <span className="text-sm/none text-nav-muted truncate">
                      <span className="text-heading tracking-[0.06em]">REF {p.tx.slice(-6).toUpperCase()}</span> · <UserHandle address={p.payer} />
                    </span>
                  </span>
                  <span className="shrink-0 flex items-center gap-1.5 text-sm/none text-nav-muted">
                    {ago(p.ts, now)} <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
