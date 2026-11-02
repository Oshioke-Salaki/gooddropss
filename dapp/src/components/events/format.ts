// Display helpers for events: local times with a short time-zone label,
// relative countdowns, and whole-G$ amounts. Pure, so cards and pages agree.

import type { EventPhase } from "@/lib/events";

export function wholeG(wei: string | bigint): string {
  const n = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  return (n / 10n ** 18n).toLocaleString("en-US");
}

export function shortG(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString("en-US");
}

// Times are shown in the venue's time zone when the event has one (a Nairobi
// meetup reads in Nairobi time wherever you look at it), otherwise in the
// viewer's own zone, which is what older events always did.

/** "GMT+1", "WAT", "EAT"… for the zone (the viewer's when none is given). */
export function tzLabel(atSec: number, tz?: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZoneName: "short", timeZone: tz }).formatToParts(new Date(atSec * 1000));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch { return ""; }
}

const time = (s: number, tz?: string) => new Date(s * 1000).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", timeZone: tz });
const day = (s: number, tz?: string) => new Date(s * 1000).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
const ymd = (s: number, tz?: string) => new Date(s * 1000).toLocaleDateString("en-CA", { timeZone: tz });
const sameDay = (a: number, b: number, tz?: string) => ymd(a, tz) === ymd(b, tz);

/** "Sat 14 Nov · 6:00 PM – 10:00 PM WAT" or across days "Sat 14 Nov 6:00 PM – Sun 15 Nov 2:00 AM WAT". */
export function formatRange(startsAt: number, endsAt: number, tz?: string): string {
  const label = tzLabel(startsAt, tz);
  const tail = label ? ` ${label}` : "";
  return sameDay(startsAt, endsAt, tz)
    ? `${day(startsAt, tz)} · ${time(startsAt, tz)} – ${time(endsAt, tz)}${tail}`
    : `${day(startsAt, tz)} ${time(startsAt, tz)} – ${day(endsAt, tz)} ${time(endsAt, tz)}${tail}`;
}

/** "Sat 14 Nov · 6:00 PM", plus the zone when it isn't the viewer's own. */
export function formatWhen(startsAt: number, tz?: string): string {
  const base = `${day(startsAt, tz)} · ${time(startsAt, tz)}`;
  return tz && differsFromViewer(tz, startsAt) ? `${base} ${tzLabel(startsAt, tz)}` : base;
}

/** The viewer's own IANA zone ("" if the browser won't say). */
export function viewerTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { return ""; }
}

/** Minutes the zone is ahead of UTC at that moment. */
function offsetMin(tz: string | undefined, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(atMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(atMs / 1000) * 1000) / 60_000);
}

/** True when the venue's clock reads differently from the viewer's at that time. */
export function differsFromViewer(tz: string, atSec: number): boolean {
  try { return offsetMin(tz, atSec * 1000) !== offsetMin(undefined, atSec * 1000); } catch { return false; }
}

export function span(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d >= 2) return `${d} days`;
  if (d === 1) return h ? `1 day ${h}h` : "1 day";
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return `${m}m`;
  return "under a minute";
}

/** "Starts in 3h 20m" · "Live · ends 9:00 PM" · "Ended 2 days ago". */
export function relativeLine(phase: EventPhase, startsAt: number, endsAt: number, now: number, tz?: string): string {
  if (phase === "upcoming") return `Starts in ${span(startsAt - now)}`;
  if (phase === "live") return `Live · ends ${sameDay(now, endsAt, tz) ? time(endsAt, tz) : `${day(endsAt, tz)} ${time(endsAt, tz)}`}`;
  return `Ended ${span(now - endsAt)} ago`;
}

export function ago(sec: number, now: number): string {
  const d = now - sec;
  if (d < 60) return "just now";
  return `${span(d)} ago`;
}

export function distanceLabel(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m away`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace(/\.0$/, "") : Math.round(km).toLocaleString()} km away`;
}

/**
 * "2026-11-14T18:00" as the clock reads in `tz` (the viewer's own zone when
 * none), for <input type="datetime-local">.
 */
export function toLocalInput(sec: number, tz?: string): string {
  const d = new Date((sec + offsetMin(tz, sec * 1000) * 60) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Inverse of toLocalInput: a wall-clock time in `tz` to unix seconds. NaN when empty/invalid. */
export function fromLocalInput(v: string, tz?: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v ?? "");
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (!Number.isFinite(wall)) return NaN;
  try {
    // Guess with the offset at the wall time, then correct once for a DST edge.
    let t = wall - offsetMin(tz, wall) * 60_000;
    t = wall - offsetMin(tz, t) * 60_000;
    return Math.floor(t / 1000);
  } catch { return NaN; }
}
