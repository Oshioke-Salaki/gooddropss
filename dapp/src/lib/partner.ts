// Shared sign-in with a partner app that also uses Magic.
//
// A Magic Dedicated Wallet belongs to the app (publishable key) that created it,
// so a partner's user has no wallet here. Rather than migrate identities, we
// let them sign in with the partner's OWN key from our domain: same email, same
// wallet, already GoodDollar-verified, no re-verification and no linking tx.
// The partner adds our domain to their Magic allowlist; we do the same for them.
//
// Everything is inert until NEXT_PUBLIC_PARTNER_MAGIC_KEY is set, so this can
// ship ahead of the partner's details and be switched on with an env change.

export const PARTNER_CONNECTOR_ID = "magic-partner";

export interface PartnerConfig {
  /** The partner's Magic PUBLISHABLE key (pk_live_…). Safe to expose. */
  key: string;
  name: string;
  /** Partner's site, for the "don't have an account?" nudge. */
  url: string;
  /** Logo for the sign-in row. Any absolute URL or /public path. */
  logo: string;
}

export const PARTNER: PartnerConfig | null = (() => {
  const key = process.env.NEXT_PUBLIC_PARTNER_MAGIC_KEY;
  if (!key) return null;
  return {
    key,
    name: process.env.NEXT_PUBLIC_PARTNER_NAME || "our partner app",
    url: process.env.NEXT_PUBLIC_PARTNER_URL || "",
    logo: process.env.NEXT_PUBLIC_PARTNER_LOGO_URL || "",
  };
})();

// Which door the user came through last time. A partner user shouldn't have to
// find the partner row on every visit — the sheet opens on their path directly.
const LAST_LOGIN_KEY = "gd:lastLogin";
export type LoginSource = "gooddrops" | "partner";

export function rememberLogin(source: LoginSource) {
  try { localStorage.setItem(LAST_LOGIN_KEY, source); } catch { /* private mode */ }
}
export function lastLogin(): LoginSource | null {
  try {
    const v = localStorage.getItem(LAST_LOGIN_KEY);
    return v === "partner" || v === "gooddrops" ? v : null;
  } catch { return null; }
}
