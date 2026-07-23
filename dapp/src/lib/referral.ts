// Referral engine — invite links + identity-scoped attribution. Everything is
// keyed to the GoodDollar identity ROOT (not a wallet), so alts of the same
// person can't farm referrals, and a referred person counts once across all
// their linked wallets. Sybil resistance piggybacks on GoodDollar verification.

export const REF_PARAM = "ref";              // ?ref=<address> on invite links
export const REF_STORAGE_KEY = "gd_ref";     // pending referrer captured on landing
export const REF_DONE_KEY = "gd_ref_done";   // attribution completed for this device

export const REF_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

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

// Append a referral code to any URL (claim/hunter share links), preserving an
// existing query string. No-op for a missing/invalid address.
export function withRef(url: string, address?: string | null): string {
  if (!address || !REF_ADDR_RE.test(address)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${REF_PARAM}=${address.toLowerCase()}`;
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
