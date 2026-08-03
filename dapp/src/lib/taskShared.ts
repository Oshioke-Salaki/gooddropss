// Client-safe task constants, types, and pure helpers — NO node deps, so both
// browser components and server routes can import them. Server-only bits (nonce
// minting via node:crypto) live in taskLock.ts, which re-exports everything here.

export const QR_TTL_S            = 300;   // a minted QR is valid for 5 minutes
export const APPROVAL_TTL_S      = 600;   // merchant approval unlocks claiming for 10 minutes
export const QR_COOLDOWN_S       = 20;    // min gap between a hunter minting nonces
export const MERCHANT_DAILY_CAP  = 200;   // max approvals per merchant per day
export const TASK_MAX_LEN        = 80;    // task text length cap

export interface TaskQrRecord { dropId: string; root: string; spotId: string }
export interface TaskDropRecord { spotId: string; task: string; createdAt: number }

export function cleanTask(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TASK_MAX_LEN);
}
export function isValidTask(raw: string): boolean {
  const t = cleanTask(raw);
  return t.length >= 3 && t.length <= TASK_MAX_LEN;
}
