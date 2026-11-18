// Valora (Celo mobile wallet) helpers. Valora's Discover in-app browser does NOT
// inject an EIP-1193 provider, so we can't connect to it directly like MiniPay/
// MetaMask. Instead we connect over WalletConnect and deep-link the pairing URI
// straight into Valora — skipping WalletConnect's generic wallet list entirely.
export const VALORA_WC_ID = "d01c7758d741b363e637a817a09bcf579feae4db9f5bb16f599fdd1f66e2f974";

// True when the page is running inside an in-app WebView — which, for a Celo G$
// dapp, is overwhelmingly Valora's Discover browser.
//
// Valora does NOT tag its user-agent (it's a bare iOS WKWebView UA, e.g.
// "...AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" — note: no "Safari"
// and no "Version/" token, unlike real mobile Safari). So we can't match "Valora"
// directly; instead we detect the WebView signature: on iOS a WKWebView omits the
// "Safari" token real Safari always includes; on Android a WebView carries ";wv)".
//
// Two things rule Valora out:
// - an injected wallet (window.ethereum). Valora never injects one (checked against
//   its wallet-stack source, Nov 2026), so this is MiniPay / MetaMask / Opera etc.,
//   which connect directly and must keep WalletConnect's normal wallet list.
// - a social app's own browser (Instagram, Facebook, TikTok, X, Telegram, Snapchat,
//   LinkedIn, LINE). Those tag their user-agent, and people arriving from campaign
//   links there may not have Valora at all, so they get the normal wallet list too.
// Ordinary desktop / mobile-browser users never match.
const SOCIAL_IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|TikTok|musical_ly|BytedanceWebview|Twitter|Telegram|Snapchat|LinkedInApp|\bLine\//i;

export function isValoraBrowser(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  if ((window as unknown as { ethereum?: unknown }).ethereum) return false;
  const ua = navigator.userAgent;
  if (SOCIAL_IN_APP.test(ua)) return false;
  const iosWebView = /(iPhone|iPod|iPad)/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua);
  const androidWebView = /;\s*wv\)/.test(ua);
  return iosWebView || androidWebView;
}
