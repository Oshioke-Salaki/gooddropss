// Referral engine — invite links + identity-scoped attribution. Everything is
// keyed to the GoodDollar identity ROOT (not a wallet), so alts of the same
// person can't farm referrals, and a referred person counts once across all
// their linked wallets. Sybil resistance piggybacks on GoodDollar verification.
//
// This file is shared by the browser and the server; the server-only ledger
// (pending invites, crediting, the referrer's account) is lib/referralLedger.

import { PARTNER_CONNECTOR_ID } from "@/lib/partner";

export const REF_PARAM = "ref";              // ?ref=<address> on invite links
export const REF_STORAGE_KEY = "gd_ref";     // pending referrer captured on landing

export const REF_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** A captured invite stays on the device this long if the person never signs in. */
export const REF_CAPTURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The invitee signs this exact string; the server recovers the signer (= invitee)
// and rebuilds the message from the referrer + timestamp it was sent with, so a
// signature can't be replayed to attribute a different pairing.
export function referralAcceptMessage(referrer: string, timestamp: number): string {
  return `GoodDrops referral:accept:${referrer.toLowerCase()}:${timestamp}`;
}

// Build a shareable invite link for a given wallet.
export function inviteUrl(base: string, address: string): string {
  const b = base.replace(/\/$/, "");
  return `${b}/?${REF_PARAM}=${address.toLowerCase()}`;
}

// Put a referral code on any URL (claim/hunter share links), keeping the rest of
// the query string. An existing ref is replaced, never duplicated: with two,
// URLSearchParams.get() would read the first one and credit the wrong person.
// No-op for a missing/invalid address.
export function withRef(url: string, address?: string | null): string {
  if (!address || !REF_ADDR_RE.test(address)) return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = base.indexOf("?");
  const path = qAt >= 0 ? base.slice(0, qAt) : base;
  const params = new URLSearchParams(qAt >= 0 ? base.slice(qAt + 1) : "");
  params.delete(REF_PARAM);
  params.append(REF_PARAM, address.toLowerCase());
  return `${path}?${params.toString()}${hash}`;
}

// ── The invite a device is carrying ──────────────────────────────────────────
// First touch wins on a device, like it does on the server: opening a second
// person's link later doesn't take the invite away from whoever sent the first.
// Expires so a link opened months ago doesn't attribute a sign-up today.

export interface CapturedRef { ref: string; at: number }

/** Parse what's stored. Accepts the old format (a bare address) too. */
export function parseCapturedRef(raw: string | null, now = Date.now()): CapturedRef | null {
  if (!raw) return null;
  let v: CapturedRef | null = null;
  if (REF_ADDR_RE.test(raw)) v = { ref: raw.toLowerCase(), at: now };
  else {
    try {
      const o = JSON.parse(raw) as Partial<CapturedRef>;
      if (o && typeof o.ref === "string" && REF_ADDR_RE.test(o.ref) && typeof o.at === "number" && Number.isFinite(o.at)) {
        v = { ref: o.ref.toLowerCase(), at: o.at };
      }
    } catch { /* not ours */ }
  }
  if (!v || now - v.at > REF_CAPTURE_TTL_MS || v.at > now + 60_000) return null;
  return v;
}

/** What to store after landing on `?ref=`: the existing invite if it's still live, else this one. */
export function nextCapturedRef(existing: string | null, incoming: string, now = Date.now()): CapturedRef | null {
  if (!REF_ADDR_RE.test(incoming)) return parseCapturedRef(existing, now);
  return parseCapturedRef(existing, now) ?? { ref: incoming.toLowerCase(), at: now };
}

export function readCapturedRef(): CapturedRef | null {
  try {
    const raw = localStorage.getItem(REF_STORAGE_KEY);
    const v = parseCapturedRef(raw);
    if (raw && !v) localStorage.removeItem(REF_STORAGE_KEY); // expired or junk
    return v;
  } catch { return null; }
}

export function captureRef(incoming: string): void {
  try {
    const next = nextCapturedRef(localStorage.getItem(REF_STORAGE_KEY), incoming);
    if (next) localStorage.setItem(REF_STORAGE_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
}

export function clearCapturedRef(): void {
  try { localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
}

// ── Wallets ──────────────────────────────────────────────────────────────────
// Magic's embedded wallets (ours and the partner's) confirm a message without
// showing anything, so an invite can be accepted in the background. Every other
// wallet (MiniPay, Valora, MetaMask, WalletConnect…) shows the person a prompt,
// so they get a card explaining what they're confirming first.
const SILENT_CONNECTORS = new Set(["magic", PARTNER_CONNECTOR_ID]);
export function confirmsSilently(connectorId: string | undefined | null): boolean {
  return !!connectorId && SILENT_CONNECTORS.has(connectorId);
}

// ── What the server says about an invite ─────────────────────────────────────

/** The outcome of offering or re-checking an invite (POST /api/referral, /settle). */
export type InviteStatus =
  | "credited"   // counted now
  | "already"    // this person was already counted (for this referrer or another)
  | "waiting"    // saved; counts once they're verified and have claimed or hidden a drop
  | "rejected"   // can never count (see reason)
  | "none";      // nothing saved for this wallet

export type InviteReason =
  | "verify"     // waiting: not a verified GoodDollar human yet
  | "task"       // waiting: hasn't claimed or created a drop yet
  | "retry"      // waiting: we couldn't check just now
  | "self"       // rejected: same person as the referrer
  | "notNew"     // rejected: was already playing before the invite
  | "taken"      // rejected: someone else invited them first
  | "expired";   // rejected: waited too long without qualifying

export interface InviteResult { status: InviteStatus; reason?: InviteReason; referrer?: string }

/** Terminal = nothing more will ever happen for this invite. */
export function isFinalInvite(status: InviteStatus): boolean {
  return status === "credited" || status === "already" || status === "rejected";
}

/**
 * What to tell the INVITEE about their invite, in plain words. `name` is how to
 * refer to the person who invited them ("@ada", or a short address).
 */
export function inviteOutcome(r: InviteResult, name: string): { tone: "ok" | "info" | "error"; text: string } {
  switch (r.status) {
    case "credited":
      return { tone: "ok", text: `Your invite from ${name} counted. Thanks for joining!` };
    case "already":
      return { tone: "ok", text: `You're already counted as ${name}'s invite.` };
    case "waiting":
      if (r.reason === "verify") return { tone: "ok", text: `Saved. It counts for ${name} once you verify you're a real person and find or hide your first drop.` };
      if (r.reason === "task") return { tone: "ok", text: `Saved. It counts for ${name} as soon as you find or hide your first drop.` };
      return { tone: "ok", text: `Saved. It counts for ${name} as soon as you're all set up.` };
    case "rejected":
      if (r.reason === "self") return { tone: "error", text: "That's your own invite link. Share it with a friend instead." };
      if (r.reason === "notNew") return { tone: "error", text: "Invites are for people new to GoodDrops, so this one can't count." };
      if (r.reason === "taken") return { tone: "error", text: "You already joined through someone else's invite." };
      if (r.reason === "expired") return { tone: "error", text: "This invite has expired." };
      return { tone: "error", text: "This invite can't be counted." };
    default:
      return { tone: "info", text: "" };
  }
}

/** "0x1234…abcd" */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Read who invited someone from what they typed: an invite link (any URL with
 * ?ref=0x…), a bare 0x address, or a username (with or without @).
 */
export function parseInviterInput(raw: string): { kind: "address"; address: string } | { kind: "username"; username: string } | null {
  const v = raw.trim();
  if (!v) return null;
  if (REF_ADDR_RE.test(v)) return { kind: "address", address: v.toLowerCase() };
  const m = v.match(/[?&]ref=(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/);
  if (m) return { kind: "address", address: m[1].toLowerCase() };
  const u = v.replace(/^@/, "");
  if (/^[a-zA-Z0-9_-]{3,24}$/.test(u)) return { kind: "username", username: u };
  return null;
}

// Playful status tiers by number of people you've brought in — gives referrals a
// visible reward without any treasury.
export function recruiterTier(count: number): { label: string; icon: string } {
  if (count >= 25) return { label: "Kingpin",   icon: "👑" };
  if (count >= 10) return { label: "Ringleader", icon: "🔥" };
  if (count >= 5)  return { label: "Connector",  icon: "🌟" };
  if (count >= 1)  return { label: "Recruiter",  icon: "🌱" };
  return { label: "Newcomer", icon: "🫥" };
}
