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
// If a non-Valora in-app WebView ever matches, the only effect is the wallet button
// targets Valora — and Google / email sign-in sits right above it as the fallback,
// so nobody is ever stuck. Ordinary desktop / mobile-browser users never match.
export function isValoraBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iosWebView = /(iPhone|iPod|iPad)/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua);
  const androidWebView = /;\s*wv\)/.test(ua);
  return iosWebView || androidWebView;
}
