// Events: meetups, concerts, campus days… with G$ drops hidden around them.
//
// This file is the single source of truth for the rules — validation, the
// event lifecycle, the drop tag, the claim gate and the live stats — as pure
// functions, so the API routes, the UI and the tests all agree.
//
// How it fits together:
//   • An organizer submits an event (signed). Admins approve it before it's
//     public. Edits to an approved event wait in `pendingEdit` for review while
//     the approved version stays live.
//   • Event drops are ordinary on-chain drops whose clue starts with [E:<id>].
//     Only drops by the organizer or a co-host count toward the event, so
//     nobody can pad an event's numbers by tagging their own drops.
//   • Drops loaded before the start are hidden from the map and the server
//     refuses to sign their claim proofs until the event starts.
//   • Stats come from the chain (via the subgraph), never from self-reports.

import { keccak256, toBytes } from "viem";
import { DROP_STATUS, type Drop } from "@/types";

export const EVENT_CATEGORIES = [
  "meetup", "concert", "campus", "sports", "market", "festival", "community", "other",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  meetup: "Meetup", concert: "Concert", campus: "Campus", sports: "Sports",
  market: "Market", festival: "Festival", community: "Community", other: "Event",
};

export type EventStatus = "pending" | "approved" | "rejected" | "cancelled";
export type EventPhase = "upcoming" | "live" | "ended";

/** The fields an organizer controls. */
export interface EventDraft {
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  lat: number;
  lng: number;
  startsAt: number; // unix seconds
  endsAt: number;   // unix seconds
  budgetG: number;  // whole G$ the organizer plans to drop
  link: string;     // optional https URL ("" when none)
  cohosts: string[]; // lowercased addresses that may drop for the event
  /**
   * Most drops one person may find at this event; 0 means no limit. Left out
   * of drafts signed before it existed, which then get LIMITS.perPersonDefault.
   */
  perPerson?: number;
  /** IANA time zone of the venue, e.g. "Africa/Nairobi". Absent on older events. */
  tz?: string;
}

export interface GdEvent extends EventDraft {
  id: string;
  organizer: string; // lowercased address
  status: EventStatus;
  rejectReason?: string;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  cancelledAt?: number;
  /** Changes to an approved event, waiting for admin review. */
  pendingEdit?: EventDraft | null;
}

export const LIMITS = {
  titleMin: 3, titleMax: 80,
  descriptionMax: 1000,
  venueMax: 80,
  minDurationS: 30 * 60,
  maxDurationS: 7 * 86_400,
  maxLeadS: 180 * 86_400,      // can't schedule more than ~6 months out
  budgetMin: 10,
  budgetMax: 10_000_000,
  maxCohosts: 5,
  maxOpenPerOrganizer: 3,      // pending + upcoming approved at once
  sigWindowMs: 10 * 60 * 1000, // a signature is good for 10 minutes
  /** How long before the start interested people get a reminder push. */
  reminderLeadS: 60 * 60,
  perPersonDefault: 3,
  perPersonMax: 50,
  /** Partner hosts (admin-trusted) skip review and can run more at once. */
  maxOpenTrusted: 20,
  /** Claims started right at the end still go through for this long. */
  endGraceS: 10 * 60,
} as const;

/** The choices a host gets for the per-person limit (0 = no limit). */
export const PER_PERSON_CHOICES = [1, 2, 3, 5, 10, 0] as const;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ID_RE = /^[a-z0-9]{6,20}$/;

export function isEventId(s: unknown): s is string {
  return typeof s === "string" && ID_RE.test(s);
}

export function newEventId(): string {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 14);
}

// ── Validation ───────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Turn untrusted input into a valid draft, or say exactly what's wrong.
 * `now` is unix seconds. `allowStarted` lets an already-live event be edited
 * without tripping "start must be in the future".
 */
export function validateDraft(input: unknown, now: number, opts: { allowStarted?: boolean; organizer?: string } = {}): Result<EventDraft> {
  const i = (input ?? {}) as Record<string, unknown>;

  const title = clean(i.title, LIMITS.titleMax);
  if (title.length < LIMITS.titleMin) return { ok: false, error: `Give the event a name (at least ${LIMITS.titleMin} characters).` };

  // Descriptions keep their line breaks; only trim the ends.
  const description = typeof i.description === "string" ? i.description.trim().slice(0, LIMITS.descriptionMax) : "";

  const category = (EVENT_CATEGORIES as readonly string[]).includes(String(i.category)) ? (i.category as EventCategory) : null;
  if (!category) return { ok: false, error: "Pick a category." };

  const venueName = clean(i.venueName, LIMITS.venueMax);
  if (venueName.length < 2) return { ok: false, error: "Name the venue so people know where to go." };

  const lat = Number(i.lat), lng = Number(i.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return { ok: false, error: "Pin the venue on the map." };
  }

  const startsAt = Math.floor(Number(i.startsAt));
  const endsAt = Math.floor(Number(i.endsAt));
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return { ok: false, error: "Set a start and end time." };
  if (endsAt <= startsAt) return { ok: false, error: "The event has to end after it starts." };
  if (endsAt - startsAt < LIMITS.minDurationS) return { ok: false, error: "Events need to last at least 30 minutes." };
  if (endsAt - startsAt > LIMITS.maxDurationS) return { ok: false, error: "Events can last at most 7 days." };
  if (!opts.allowStarted && startsAt < now - 5 * 60) return { ok: false, error: "The start time is in the past." };
  if (endsAt <= now) return { ok: false, error: "The end time is in the past." };
  if (startsAt > now + LIMITS.maxLeadS) return { ok: false, error: "Events can be scheduled up to 6 months ahead." };

  const budgetG = Math.floor(Number(i.budgetG));
  if (!Number.isFinite(budgetG) || budgetG < LIMITS.budgetMin) return { ok: false, error: `Set a G$ budget of at least ${LIMITS.budgetMin} G$.` };
  if (budgetG > LIMITS.budgetMax) return { ok: false, error: "That budget is too large." };

  let link = typeof i.link === "string" ? i.link.trim() : "";
  if (link) {
    if (!/^https?:\/\//i.test(link)) link = `https://${link}`;
    try {
      const u = new URL(link);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad");
      if (!u.hostname.includes(".")) throw new Error("bad");
      link = u.toString().slice(0, 300);
    } catch {
      return { ok: false, error: "That link doesn't look right." };
    }
  }

  const raw = Array.isArray(i.cohosts) ? i.cohosts : [];
  const cohosts: string[] = [];
  for (const a of raw) {
    if (typeof a !== "string" || !ADDR_RE.test(a.trim())) return { ok: false, error: "A co-host address isn't a valid wallet address." };
    const lower = a.trim().toLowerCase();
    if (lower === opts.organizer?.toLowerCase()) continue; // the organizer is always a host
    if (!cohosts.includes(lower)) cohosts.push(lower);
  }
  if (cohosts.length > LIMITS.maxCohosts) return { ok: false, error: `At most ${LIMITS.maxCohosts} co-hosts.` };

  const value: EventDraft = { title, description, category, venueName, lat, lng, startsAt, endsAt, budgetG, link, cohosts };

  // Both are optional keys: a draft signed without them must hash the same.
  if (i.perPerson !== undefined && i.perPerson !== null) {
    const n = Number(i.perPerson);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.perPersonMax) return { ok: false, error: "Pick how many drops one person can find." };
    value.perPerson = n;
  }
  if (i.tz !== undefined && i.tz !== null && i.tz !== "") {
    if (!isTimeZone(i.tz)) return { ok: false, error: "Pick the venue's time zone." };
    value.tz = i.tz;
  }
  return { ok: true, value };
}

/** A real IANA zone name this runtime can format with. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$|^UTC$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/** The organizer-controlled fields of an event, as a draft. */
export function draftOf(e: EventDraft): EventDraft {
  const d: EventDraft = {
    title: e.title, description: e.description, category: e.category, venueName: e.venueName,
    lat: e.lat, lng: e.lng, startsAt: e.startsAt, endsAt: e.endsAt, budgetG: e.budgetG, link: e.link, cohosts: e.cohosts,
  };
  if (e.perPerson !== undefined) d.perPerson = e.perPerson;
  if (e.tz !== undefined) d.tz = e.tz;
  return d;
}

/** Most drops one person may find; Infinity when the host chose no limit. */
export function perPersonCap(e: Pick<EventDraft, "perPerson">): number {
  const n = e.perPerson ?? LIMITS.perPersonDefault;
  return n === 0 ? Infinity : n;
}

/**
 * Edits that can go live without review on an approved event: the end time
 * and the per-person limit. Nothing a hunter decides to travel on (place,
 * start, what it is) and nothing public-facing that could be abused.
 */
export function isSafeEdit(live: EventDraft, next: EventDraft): boolean {
  const a = draftOf(live), b = draftOf(next);
  // Older events have no time zone; the first edit from the new form adds one.
  const strip = (d: EventDraft) => ({ ...d, endsAt: 0, perPerson: undefined, tz: a.tz === undefined ? undefined : d.tz });
  return canonical(strip(a)) === canonical(strip(b));
}

// ── Signing ──────────────────────────────────────────────────────────────────
// The organizer signs a digest of exactly what they submitted, bound to the
// action, the event and a timestamp — so a signature can't be replayed for a
// different event, a different action, or edited content.

/** Canonical JSON (sorted keys) so the client and server hash the same bytes. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function draftDigest(d: EventDraft | null): string {
  return d ? keccak256(toBytes(canonical(d))).slice(0, 18) : "none";
}

export type EventAction = "create" | "edit" | "cancel";

export function eventMessage(action: EventAction, id: string, timestamp: number, digest: string): string {
  return `GoodDrops event\nAction: ${action}\nEvent: ${id}\nContent: ${digest}\nTime: ${timestamp}`;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function eventPhase(e: Pick<GdEvent, "startsAt" | "endsAt">, now: number): EventPhase {
  if (now < e.startsAt) return "upcoming";
  if (now < e.endsAt) return "live";
  return "ended";
}

/** Public = approved. Cancelled events stay reachable by link but say so. */
export function isPublic(e: GdEvent): boolean {
  return e.status === "approved";
}

export function hostsOf(e: Pick<GdEvent, "organizer" | "cohosts">): Set<string> {
  return new Set([e.organizer.toLowerCase(), ...e.cohosts.map((a) => a.toLowerCase())]);
}

/**
 * Can a drop tagged for this event be claimed right now?
 * Locked before an approved event starts, after it ends (past a short grace),
 * and for good once it's cancelled, and only for drops placed by its hosts. A
 * tag on anyone else's drop, or for an unknown/pending/rejected event, changes
 * nothing.
 */
export function eventClaimGate(
  e: GdEvent | null,
  dropper: string,
  now: number,
): { locked: false } | { locked: true; reason: string; startsAt: number } {
  if (!e) return { locked: false };
  if (!hostsOf(e).has(dropper.toLowerCase())) return { locked: false };
  if (e.status === "approved" && now < e.startsAt) {
    return { locked: true, reason: `This drop unlocks when ${e.title} starts.`, startsAt: e.startsAt };
  }
  // A cancelled event's hunt is off, whenever it was cancelled: what's left
  // goes back to the host once the drops expire.
  if (e.status === "cancelled") {
    return { locked: true, reason: `${e.title} was cancelled, so its drops stay locked.`, startsAt: e.startsAt };
  }
  // Taken down by an admin after approval: same, so a removal can't release
  // drops that were waiting for the start.
  if (e.status === "rejected" && e.approvedAt) {
    return { locked: true, reason: `${e.title} was taken down, so its drops stay locked.`, startsAt: e.startsAt };
  }
  // After the end (plus a short grace for claims already under way) the
  // leftovers belong to the host, not to whoever walks by later.
  if (e.status === "approved" && now >= e.endsAt + LIMITS.endGraceS) {
    return { locked: true, reason: `The hunt at ${e.title} has ended.`, startsAt: e.startsAt };
  }
  return { locked: false };
}

// ── Drop tag ─────────────────────────────────────────────────────────────────

export const EVENT_TAG_RE = /^\[E:([a-z0-9]{6,20})\]([\s\S]*)/;

export function buildEventHint(hint: string, eventId: string): string {
  return `[E:${eventId}]${hint}`;
}

// ── Live stats ───────────────────────────────────────────────────────────────

const ZERO = "0x0000000000000000000000000000000000000000";

export interface EventStats {
  drops: number;
  droppedWei: bigint;
  claims: number;
  claimedWei: bigint;
  /** Drops still out there and claimable (or waiting for the start). */
  live: number;
  liveWei: bigint;
  /** Distinct people (identity roots) who found G$ at the event. */
  hunters: number;
  firstClaimAt: number | null;
  lastClaimAt: number | null;
  recent: { dropId: string; claimer: string; amountWei: bigint; claimedAt: number }[];
  topHunters: { address: string; claims: number; wei: bigint }[];
}

export const EMPTY_STATS: EventStats = {
  drops: 0, droppedWei: 0n, claims: 0, claimedWei: 0n, live: 0, liveWei: 0n, hunters: 0,
  firstClaimAt: null, lastClaimAt: null, recent: [], topHunters: [],
};

/**
 * Stats for one event from its tagged drops. `drops` may include drops for
 * other events or by non-hosts; only this event's host drops are counted.
 * `rootOf` collapses a person's wallets (GoodDollar identity root).
 */
export function computeEventStats(
  e: Pick<GdEvent, "id" | "organizer" | "cohosts">,
  drops: Drop[],
  now: number,
  rootOf: (addr: string) => string = (a) => a.toLowerCase(),
): EventStats {
  const hosts = hostsOf(e);
  const mine = drops.filter((d) => {
    const m = EVENT_TAG_RE.exec(stripOuterTags(d.hint));
    return m?.[1] === e.id && hosts.has(d.dropper.toLowerCase());
  });

  const s: EventStats = { ...EMPTY_STATS, recent: [], topHunters: [] };
  const perHunter = new Map<string, { address: string; claims: number; wei: bigint; latest: number }>();

  for (const d of mine) {
    s.drops += 1;
    s.droppedWei += d.amount;
    if (d.status === DROP_STATUS.Claimed && d.claimer !== ZERO) {
      s.claims += 1;
      s.claimedWei += d.amount;
      const at = d.claimedAt || 0;
      if (at) {
        s.firstClaimAt = s.firstClaimAt === null ? at : Math.min(s.firstClaimAt, at);
        s.lastClaimAt = s.lastClaimAt === null ? at : Math.max(s.lastClaimAt, at);
      }
      const root = rootOf(d.claimer);
      const prev = perHunter.get(root);
      const newer = !prev || at >= prev.latest;
      perHunter.set(root, {
        address: newer ? d.claimer.toLowerCase() : prev!.address,
        claims: (prev?.claims ?? 0) + 1,
        wei: (prev?.wei ?? 0n) + d.amount,
        latest: Math.max(prev?.latest ?? 0, at),
      });
      s.recent.push({ dropId: d.id.toString(), claimer: d.claimer.toLowerCase(), amountWei: d.amount, claimedAt: at });
    } else if (d.status === DROP_STATUS.Active && d.expiry > now) {
      s.live += 1;
      s.liveWei += d.amount;
    }
  }

  s.hunters = perHunter.size;
  s.recent.sort((a, b) => b.claimedAt - a.claimedAt);
  s.recent = s.recent.slice(0, 12);
  s.topHunters = [...perHunter.values()]
    .sort((a, b) => (b.wei === a.wei ? b.claims - a.claims : b.wei > a.wei ? 1 : -1))
    .slice(0, 5)
    .map(({ address, claims, wei }) => ({ address, claims, wei }));
  return s;
}

/** [R] and [P:…] can wrap other tags; peel them so the event tag is visible. */
export function stripOuterTags(hint: string): string {
  let h = hint;
  for (let i = 0; i < 3; i++) {
    const r = /^\[R\]([\s\S]*)/.exec(h);
    if (r) { h = r[1]; continue; }
    break;
  }
  return h;
}

/** Event id a drop is tagged for (outer [R] tolerated), or null. */
export function eventIdOf(hint: string): string | null {
  return EVENT_TAG_RE.exec(stripOuterTags(hint))?.[1] ?? null;
}

// ── Wire format (bigint → string) ────────────────────────────────────────────

export interface EventStatsJson {
  drops: number; droppedWei: string; claims: number; claimedWei: string;
  live: number; liveWei: string; hunters: number;
  firstClaimAt: number | null; lastClaimAt: number | null;
  recent: { dropId: string; claimer: string; amountWei: string; claimedAt: number }[];
  topHunters: { address: string; claims: number; wei: string }[];
}

export function statsToJson(s: EventStats): EventStatsJson {
  return {
    ...s,
    droppedWei: s.droppedWei.toString(), claimedWei: s.claimedWei.toString(), liveWei: s.liveWei.toString(),
    recent: s.recent.map((r) => ({ ...r, amountWei: r.amountWei.toString() })),
    topHunters: s.topHunters.map((h) => ({ ...h, wei: h.wei.toString() })),
  };
}

export function statsFromJson(j: EventStatsJson): EventStats {
  return {
    ...j,
    droppedWei: BigInt(j.droppedWei), claimedWei: BigInt(j.claimedWei), liveWei: BigInt(j.liveWei),
    recent: j.recent.map((r) => ({ ...r, amountWei: BigInt(r.amountWei) })),
    topHunters: j.topHunters.map((h) => ({ ...h, wei: BigInt(h.wei) })),
  };
}

/** Public shape of an event (organizer-only fields stripped for others). */
export function publicEvent(e: GdEvent, viewer?: string | null): GdEvent {
  const own = !!viewer && hostsOf(e).has(viewer.toLowerCase());
  if (own) return e;
  const { pendingEdit: _pe, rejectReason: _rr, ...rest } = e;
  return rest;
}
