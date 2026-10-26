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

/** "GMT+1", "WAT"… whatever the viewer's browser calls its zone. */
export function tzLabel(atSec: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZoneName: "short" }).formatToParts(new Date(atSec * 1000));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch { return ""; }
}

const time = (s: number) => new Date(s * 1000).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
const day = (s: number) => new Date(s * 1000).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });
const sameDay = (a: number, b: number) => new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();

/** "Sat 14 Nov · 6:00 PM – 10:00 PM WAT" or across days "Sat 14 Nov 6:00 PM – Sun 15 Nov 2:00 AM WAT". */
export function formatRange(startsAt: number, endsAt: number): string {
  const tz = tzLabel(startsAt);
  const tail = tz ? ` ${tz}` : "";
  return sameDay(startsAt, endsAt)
    ? `${day(startsAt)} · ${time(startsAt)} – ${time(endsAt)}${tail}`
    : `${day(startsAt)} ${time(startsAt)} – ${day(endsAt)} ${time(endsAt)}${tail}`;
}

export function formatWhen(startsAt: number): string {
  return `${day(startsAt)} · ${time(startsAt)}`;
}

function span(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d >= 2) return `${d} days`;
  if (d === 1) return h ? `1 day ${h}h` : "1 day";
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return `${m}m`;
  return "under a minute";
}

/** "Starts in 3h 20m" · "Live · ends 9:00 PM" · "Ended 2 days ago". */
export function relativeLine(phase: EventPhase, startsAt: number, endsAt: number, now: number): string {
  if (phase === "upcoming") return `Starts in ${span(startsAt - now)}`;
  if (phase === "live") return `Live · ends ${sameDay(now, endsAt) ? time(endsAt) : `${day(endsAt)} ${time(endsAt)}`}`;
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

/** "2026-11-14T18:00" in the viewer's local time, for <input type="datetime-local">. */
export function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inverse of toLocalInput; NaN when empty/invalid. */
export function fromLocalInput(v: string): number {
  if (!v) return NaN;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : NaN;
}
