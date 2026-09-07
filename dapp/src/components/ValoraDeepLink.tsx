"use client";
import { useEffect } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { isValoraBrowser, VALORA_WC_ID } from "@/lib/valora";

// Inside Valora's in-app browser, connect straight to Valora: WalletConnect's own
// list is suppressed (wagmi `showQrModal: false`), and here we catch the pairing
// URI the connector emits and deep-link it into Valora — so "Connect with Valora"
// opens Valora immediately instead of a 30-wallet chooser. Gated on isValoraBrowser,
// so it's inert for every other user.
export function ValoraDeepLink() {
  useEffect(() => {
    if (!isValoraBrowser()) return;
    const wc = wagmiConfig.connectors.find((c) => c.id === "walletConnect");
    if (!wc) return;

    // Valora's deep link. Default to its native scheme, then refine from the
    // authoritative WalletConnect explorer entry (pre-fetched so it's ready before
    // the user taps connect). Format matches WalletConnect's own: `${link}wc?uri=`.
    let base = "celo://wallet/wc?uri=";
    const pid = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    if (pid) {
      fetch(`https://explorer-api.walletconnect.com/v3/wallets?projectId=${pid}&ids=${VALORA_WC_ID}`)
        .then((r) => r.json())
        .then((d) => {
          const m = d?.listings?.[VALORA_WC_ID]?.mobile;
          if (m?.native) base = `${m.native}wc?uri=`;
          else if (m?.universal) base = `${String(m.universal).replace(/\/$/, "")}/wc?uri=`;
        })
        .catch(() => { /* keep the native-scheme default */ });
    }

    const onMessage = (payload: { type?: string; data?: unknown }) => {
      if (payload?.type === "display_uri" && typeof payload.data === "string") {
        window.location.href = base + encodeURIComponent(payload.data);
      }
    };
    // The walletConnect connector emits { type: "display_uri", data: uri } on its
    // emitter's "message" event.
    const emitter = (wc as unknown as { emitter: { on: (e: string, cb: (p: { type?: string; data?: unknown }) => void) => void; off: (e: string, cb: (p: { type?: string; data?: unknown }) => void) => void } }).emitter;
    emitter.on("message", onMessage);
    return () => emitter.off("message", onMessage);
  }, []);
  return null;
}
