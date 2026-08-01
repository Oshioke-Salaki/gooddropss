import { randomBytes } from "node:crypto";

// ── Merchant task-locked drops (Phase 3) — shared constants + pure helpers ────
//
// Flow: hunter does an IRL task → mints a single-use QR nonce (proves presence) →
// merchant scans it in their dashboard and approves → approval unlocks the normal
// claimWithProof path. Security lives in three places, all here or gated by these:
//   · the nonce is single-use + short-lived (merchant-scans-hunter, so a photo is
//     useless a minute later),
//   · only the SPOT OWNER can approve (signature-checked),
//   · /api/claim-proof fails CLOSED unless an approval exists.

export const QR_TTL_S            = 120;   // a minted QR is valid for 2 minutes
export const APPROVAL_TTL_S      = 600;   // merchant approval unlocks claiming for 10 minutes
export const QR_COOLDOWN_S       = 20;    // min gap between a hunter minting nonces
export const MERCHANT_DAILY_CAP  = 200;   // max approvals per merchant per day (anti-abuse)
export const TASK_MAX_LEN        = 80;    // task text length cap

// The message a merchant signs to approve a scanned QR (proves they own the spot
// wallet). Bound to the nonce so a signature can't be replayed for another scan.
export function approveMessage(nonce: string): string {
  return `GOODDROPS_TASK_APPROVE:${nonce}`;
}

// 16 bytes of entropy — unguessable, so a nonce can't be forged, only minted.
export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export interface TaskQrRecord { dropId: string; root: string; spotId: string }
export interface TaskDropRecord { spotId: string; task: string; createdAt: number }

// Clean/validate merchant task text (single line, trimmed, capped).
export function cleanTask(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TASK_MAX_LEN);
}
export function isValidTask(raw: string): boolean {
  const t = cleanTask(raw);
  return t.length >= 3 && t.length <= TASK_MAX_LEN;
}
