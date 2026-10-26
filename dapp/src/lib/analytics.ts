import { track as vercelTrack } from "@vercel/analytics";

// The funnel we care about: opened -> signed in -> verified -> first claim ->
// first drop -> invited. Event names are fixed here so a typo can't silently
// create a new, never-graphed series in the dashboard.
type Events = {
  sign_in_opened: Record<string, never>;
  sign_in_completed: { method: "email" | "google" | "wallet" | "partner" };
  verify_started: Record<string, never>;
  verify_completed: Record<string, never>;
  onboarding_avatar_saved: Record<string, never>;
  onboarding_name_saved: Record<string, never>;
  claim_started: { surface: "sheet" | "page" | "hunt" };
  claim_succeeded: { rarity: string; surface: "sheet" | "page" | "hunt" };
  claim_failed: { reason: ClaimFailReason; surface: "sheet" | "page" | "hunt" };
  hunt_started: Record<string, never>;
  drop_created: { kind: "single" | "multi" | "chain"; count?: number };
  shop_payment_succeeded: { amountG: number };
  invite_link_copied: Record<string, never>;
  event_submitted: { category: string };
  event_reminder_on: Record<string, never>;
  event_shared: Record<string, never>;
  event_calendar_added: Record<string, never>;
};

export type ClaimFailReason =
  | "rejected" | "too_far" | "not_verified" | "already_claimed" | "expired" | "gas" | "network" | "other";

/** Sort a raw claim error into a handful of buckets — never send the message itself. */
export function claimFailReason(e: unknown): ClaimFailReason {
  const m = String((e as { shortMessage?: string; message?: string })?.shortMessage
    ?? (e as { message?: string })?.message ?? e ?? "").toLowerCase();
  if (/reject|denied|cancel/.test(m)) return "rejected";
  if (/too far|distance|range|proof|location/.test(m)) return "too_far";
  if (/whitelist|verif|identity/.test(m)) return "not_verified";
  if (/already|claimed|gone/.test(m)) return "already_claimed";
  if (/expir/.test(m)) return "expired";
  if (/gas|fund|insufficient/.test(m)) return "gas";
  if (/network|fetch|timeout|rpc/.test(m)) return "network";
  return "other";
}

/**
 * Fire a funnel event. Never throws and is a no-op on the server, so a call
 * can sit right next to money code without ever being able to break it. Props
 * are coarse by design: no addresses, emails or exact amounts.
 */
export function track<E extends keyof Events>(event: E, ...props: Events[E] extends Record<string, never> ? [] : [Events[E]]) {
  if (typeof window === "undefined") return;
  try {
    vercelTrack(event, (props[0] ?? undefined) as Record<string, string | number | boolean | null> | undefined);
  } catch { /* analytics must never affect the app */ }
}
