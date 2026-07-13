// Riddle-locked drops. The question is public; the answer never leaves the
// server and is only ever stored salted + hashed.
//
// Enforcement is server-side, which is sound here because the contract has
// gpsRequired = true: claimWithProof() only accepts a signature from gpsSigner,
// so /api/claim-proof is already the single gate on every claim in the app.
// A wrong answer simply means no signature is issued — no gas is spent, and no
// G$ can move.
//
// Uses Web Crypto (not node:crypto) so this module stays importable from client
// components for its constants without dragging a Node builtin into the bundle.

export const RIDDLE_MAX_QUESTION = 160;
export const RIDDLE_MAX_ANSWER   = 60;

// How long the first correct answer holds an exclusive claim on the drop.
// Deliberately a *reservation*, not permanent exclusivity: a permanent lock
// would let anyone solve a riddle and never claim, freezing the dropper's G$
// until expiry. Ten minutes is enough to send a transaction, and self-heals if
// the winner's tx fails or they close the app.
export const RIDDLE_LOCK_SECONDS = 600;

// Wrong-answer throttle, per (drop, claimer).
export const RIDDLE_MAX_TRIES    = 5;
export const RIDDLE_TRY_WINDOW_S = 60;

// The dropper signs this to prove they own the drop they're locking. Shared so
// the client and the verifying route can never drift out of sync.
export function riddleOwnershipMessage(dropId: string): string {
  return `GoodDrops — lock drop #${dropId} with a riddle.\n\nSigning this proves you created the drop. It costs nothing and sends no transaction.`;
}

export interface RiddleRecord {
  question:   string;
  answerHash: string;
  salt:       string;
  dropper:    string;
  createdAt:  number;
}

// Answers are compared on meaning, not keystrokes: "The Red Bench!" === "red bench".
// Accents are folded and punctuation dropped, but letters/digits in any script are
// kept (\p{L}/\p{N}), so non-Latin answers still work.
//
// A leading English article is dropped too — a dropper who sets "red bench" and a
// hunter who types "the red bench" mean the same thing, and being pedantic about it
// is the fastest way to make this feature feel broken. It's a no-op in other
// languages, which is fine. Guarded so an answer that IS an article ("the") survives.
export function normalizeAnswer(raw: string): string {
  const base = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  return base.replace(/^(?:the|a|an)\s+/, "") || base;
}

export async function hashAnswer(raw: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${normalizeAnswer(raw)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time compare — the hashes are public-ish (server-side only), but this
// costs nothing and keeps timing out of the equation.
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
