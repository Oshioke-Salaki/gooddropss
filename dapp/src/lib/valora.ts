// Valora (Celo mobile wallet) helpers. Valora's Discover in-app browser does NOT
// inject an EIP-1193 provider, so we can't connect to it directly like MiniPay/
// MetaMask. Instead we connect over WalletConnect and deep-link the pairing URI
// straight into Valora — skipping WalletConnect's generic wallet list entirely.
export const VALORA_WC_ID = "d01c7758d741b363e637a817a09bcf579feae4db9f5bb16f599fdd1f66e2f974";

// True when the page is running inside Valora's in-app browser (its WebView UA
// carries "Valora"). Everything Valora-specific is gated on this, so ordinary
// desktop / mobile-browser users are never affected.
export function isValoraBrowser(): boolean {
  return typeof navigator !== "undefined" && /valora/i.test(navigator.userAgent);
}
