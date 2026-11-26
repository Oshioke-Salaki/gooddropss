// Browser: can this person withdraw G$ to naira, and what is one G$ worth in
// their bank right now? Shared by the wallet (the "≈ ₦… if you withdraw" line)
// and the win card. Asked once per page view; every caller shares the answer.

import { GOODDROPS_FEE_PERCENT } from "@/lib/goodcash";

export interface WithdrawInfo {
  /** Withdrawals are switched on and GoodCash answers. */
  enabled: boolean;
  /** Paused for a while by us: the button stays, with a calm note. */
  paused?: boolean;
  /** Visitor's connection is in Nigeria, or the device runs on Lagos time. */
  inNigeria: boolean;
  /** Naira per G$ after every fee (GoodCash's and our 1%); null if unknown. */
  nairaPerG: number | null;
}

/** The quote amount used to read the rate: large enough that rounding doesn't matter. */
export const RATE_QUOTE_G = 100_000;

/** Naira per G$ from a GoodCash quote for RATE_QUOTE_G, after our 1%. Null if the quote is unusable. */
export function nairaPerGFromQuote(quote: unknown): number | null {
  const naira = (quote as { receive?: { naira?: unknown } } | null)?.receive?.naira;
  if (typeof naira !== "number" || !Number.isFinite(naira) || naira <= 0) return null;
  return (naira / RATE_QUOTE_G) * (1 - GOODDROPS_FEE_PERCENT / 100);
}

/** True for a Nigerian connection (Vercel's country header) or a device on Lagos time. */
export function isNigeria(country: string | null | undefined, timeZone: string): boolean {
  return country === "NG" || timeZone === "Africa/Lagos";
}

function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; }
}

let probe: Promise<{ enabled: boolean; paused: boolean; inNigeria: boolean }> | null = null;
let rate: Promise<number | null> | null = null;
// The last answers, for a synchronous first render (reopening the wallet
// shows Withdraw at once instead of popping in).
let known: { enabled: boolean; paused: boolean; inNigeria: boolean } | null = null;
let knownRate: number | null = null;

/** What's already known this page view, without waiting. */
export function peekWithdrawInfo(): WithdrawInfo | null {
  return known ? { ...known, nairaPerG: knownRate } : null;
}

/** Is withdrawing on, and is this visitor in Nigeria? Fast (no rate). Never rejects. */
export function getWithdrawAvailability(): Promise<{ enabled: boolean; paused: boolean; inNigeria: boolean }> {
  if (known) return Promise.resolve(known);
  probe ??= fetch("/api/cashout/setup?probe=1")
    .then((r) => r.json() as Promise<{ enabled?: boolean; paused?: boolean; country?: string | null }>)
    .then((d) => (known = { enabled: !!d.enabled, paused: !!d.paused, inNigeria: isNigeria(d.country, deviceTimeZone()) }))
    .catch(() => { probe = null; return { enabled: false, paused: false, inNigeria: isNigeria(null, deviceTimeZone()) }; });
  return probe;
}

/** Everything, including the live naira rate (one extra request, cached). Never rejects. */
export async function getWithdrawInfo(): Promise<WithdrawInfo> {
  const a = await getWithdrawAvailability();
  // While paused there's no naira line: we'd be promising something they can't do right now.
  if (!a.enabled || a.paused) return { ...a, nairaPerG: null };
  rate ??= fetch(`/api/cashout/quote?amountG=${RATE_QUOTE_G}`)
    .then((r) => r.json())
    .then((q) => (knownRate = nairaPerGFromQuote(q)))
    .catch(() => { rate = null; return null; });
  return { ...a, nairaPerG: await rate };
}

/** Whole naira for an amount of G$, rounded down: never promise more than the bank pays. */
export function nairaFor(g: number, nairaPerG: number): number {
  return Math.floor(g * nairaPerG);
}
