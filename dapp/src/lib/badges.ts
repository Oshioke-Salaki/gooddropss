// Presence Badges — the status layer built on GPS-verified, identity-scoped
// claims. Design decisions that matter:
//
//  • Badges are evaluated LAZILY from the subgraph (identity-scoped claims +
//    created drops + streak), not in the claim hot-path. That means existing
//    hunters get their full history credited instantly at launch, evaluation
//    can't slow or break claiming, and the evaluator is a PURE function we can
//    unit-test exhaustively.
//  • Earned badges are append-only (a badge, once earned, is never revoked by
//    re-evaluation — rules may tighten later without stripping anyone).
//  • Builtin badges absorb the old "achievements" so there is ONE system.
//  • Custom badges/sets (event collections, venue badges) are admin-defined in
//    Redis and evaluated by the same engine.

import { keccak256, toBytes } from "viem";
import { parseDropHint, gpsToDeg } from "@/lib/utils";
import type { Drop } from "@/types";

// Badge type id used on-chain: uint256(keccak256(bytes(slug))). MUST match
// GoodDropsBadges.sol exactly, or a signed mint authorization won't verify.
export function badgeTypeId(slug: string): bigint {
  return BigInt(keccak256(toBytes(slug)));
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export type BadgeRule =
  | { type: "first_claim" }
  | { type: "claims_at_least"; n: number }
  | { type: "gd_claimed_at_least"; g: number }
  | { type: "first_drop" }
  | { type: "drops_at_least"; n: number }
  | { type: "single_drop_at_least"; g: number }
  | { type: "claimed_single_at_least"; g: number }          // one find of ≥ g G$
  | { type: "fast_claim_within"; seconds: number }          // created → claimed fast
  | { type: "claimed_drop_in"; dropIds: string[] }          // event/quest sets
  | { type: "claimed_near"; lat: number; lng: number; radiusM: number } // venue
  | { type: "campaign_claims"; campaignId: string; n: number }
  | { type: "streak_at_least"; n: number };

export interface BadgeDef {
  id: string;            // stable slug; custom defs must not collide with builtins
  name: string;
  emoji: string;
  description: string;
  rule: BadgeRule;
  builtin?: boolean;
}

export interface BadgeSetDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  badgeIds: string[];
}

export const BADGE_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

// ── Builtins (absorb the old achievements — one system, same thresholds) ─────

// The first seven mirror the legacy profile "achievements" one-for-one (same
// thresholds) so nobody loses status in the migration to badges.
export const BUILTIN_BADGES: BadgeDef[] = [
  { id: "first-hunt",    name: "First Hunt",    emoji: "🎯", description: "Claimed your first drop",            rule: { type: "first_claim" },                       builtin: true },
  { id: "drop-maker",    name: "Drop Maker",    emoji: "🪂", description: "Created your first drop",            rule: { type: "first_drop" },                        builtin: true },
  { id: "speed-demon",   name: "Speed Demon",   emoji: "⚡", description: "Claimed within 5 min of creation",   rule: { type: "fast_claim_within", seconds: 300 },   builtin: true },
  { id: "whale",         name: "Whale",         emoji: "🐋", description: "Dropped 200+ G$ in one go",          rule: { type: "single_drop_at_least", g: 200 },      builtin: true },
  { id: "legend",        name: "Legend",        emoji: "👑", description: "Claimed a Legendary (200+ G$) drop", rule: { type: "claimed_single_at_least", g: 200 },   builtin: true },
  { id: "collector",     name: "Collector",     emoji: "🛡️", description: "Claimed 5 or more drops",            rule: { type: "claims_at_least", n: 5 },             builtin: true },
  { id: "pioneer",       name: "Pioneer",       emoji: "🏗️", description: "Created 10+ drops",                  rule: { type: "drops_at_least", n: 10 },             builtin: true },
  { id: "serial-hunter", name: "Serial Hunter", emoji: "🔟", description: "Claimed 10 drops",                   rule: { type: "claims_at_least", n: 10 },            builtin: true },
  { id: "hunt-machine",  name: "Hunt Machine",  emoji: "💯", description: "Claimed 50 drops",                   rule: { type: "claims_at_least", n: 50 },            builtin: true },
  { id: "money-magnet",  name: "Money Magnet",  emoji: "🧲", description: "Found 1,000+ G$ in total",           rule: { type: "gd_claimed_at_least", g: 1000 },      builtin: true },
  { id: "on-fire",       name: "On Fire",       emoji: "🔥", description: "Reached a 7-day hunting streak",     rule: { type: "streak_at_least", n: 7 },             builtin: true },
];

const BUILTIN_IDS = new Set(BUILTIN_BADGES.map((b) => b.id));
export function isBuiltinBadgeId(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

// ── Pure evaluator ───────────────────────────────────────────────────────────

export interface BadgeInputs {
  /** identity-scoped drops this person CLAIMED (from the subgraph) */
  claimed: Drop[];
  /** identity-scoped drops this person CREATED */
  created: Drop[];
  /** best hunting streak (days) — 0 when unknown */
  bestStreak: number;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const toG = (wei: bigint) => Number(wei / 10n ** 18n);

export function ruleSatisfied(rule: BadgeRule, s: BadgeInputs): boolean {
  switch (rule.type) {
    case "first_claim":         return s.claimed.length >= 1;
    case "claims_at_least":     return s.claimed.length >= rule.n;
    case "gd_claimed_at_least": return s.claimed.reduce((sum, d) => sum + toG(d.amount), 0) >= rule.g;
    case "first_drop":          return s.created.length >= 1;
    case "drops_at_least":      return s.created.length >= rule.n;
    case "single_drop_at_least":return s.created.some((d) => toG(d.amount) >= rule.g);
    case "claimed_single_at_least": return s.claimed.some((d) => toG(d.amount) >= rule.g);
    case "fast_claim_within":
      return s.claimed.some(
        (d) => d.claimedAt > 0 && d.createdAt > 0 && d.claimedAt - d.createdAt <= rule.seconds,
      );
    case "streak_at_least":     return s.bestStreak >= rule.n;
    case "claimed_drop_in": {
      const wanted = new Set(rule.dropIds.map(String));
      return s.claimed.some((d) => wanted.has(d.id.toString()));
    }
    case "claimed_near":
      // Uses the DROP's on-chain coordinates (degrees × 1e6), so it works for
      // historical claims too — no dependency on stored user positions.
      return s.claimed.some((d) => {
        const lat = gpsToDeg(d.lat);
        const lng = gpsToDeg(d.lng);
        if (lat === 0 && lng === 0) return false; // private drops hide coords
        return haversineM(lat, lng, rule.lat, rule.lng) <= rule.radiusM;
      });
    case "campaign_claims": {
      const n = s.claimed.filter((d) => parseDropHint(d.hint).campaignId === rule.campaignId).length;
      return n >= rule.n;
    }
    default:
      return false; // unknown rule (defs from a newer version) — never award blind
  }
}

/** Every badge id (from defs) this person is currently eligible for. */
export function evaluateBadges(defs: BadgeDef[], s: BadgeInputs): string[] {
  return defs.filter((d) => ruleSatisfied(d.rule, s)).map((d) => d.id);
}

// Basic structural validation for admin-supplied custom defs.
export function isValidRule(r: unknown): r is BadgeRule {
  if (typeof r !== "object" || r === null) return false;
  const rule = r as Record<string, unknown>;
  switch (rule.type) {
    case "first_claim":
    case "first_drop":
      return true;
    case "claims_at_least":
    case "drops_at_least":
    case "streak_at_least":
      return typeof rule.n === "number" && rule.n >= 1 && rule.n <= 100000;
    case "gd_claimed_at_least":
    case "single_drop_at_least":
    case "claimed_single_at_least":
      return typeof rule.g === "number" && rule.g >= 1 && rule.g <= 1e9;
    case "fast_claim_within":
      return typeof rule.seconds === "number" && rule.seconds >= 10 && rule.seconds <= 86_400;
    case "claimed_drop_in":
      return Array.isArray(rule.dropIds) && rule.dropIds.length >= 1 && rule.dropIds.length <= 200 &&
        rule.dropIds.every((x) => typeof x === "string" && /^[0-9]{1,20}$/.test(x));
    case "claimed_near":
      return typeof rule.lat === "number" && Math.abs(rule.lat as number) <= 90 &&
        typeof rule.lng === "number" && Math.abs(rule.lng as number) <= 180 &&
        typeof rule.radiusM === "number" && (rule.radiusM as number) >= 20 && (rule.radiusM as number) <= 100_000;
    case "campaign_claims":
      return typeof rule.campaignId === "string" && (rule.campaignId as string).length > 0 &&
        typeof rule.n === "number" && (rule.n as number) >= 1;
    default:
      return false;
  }
}
