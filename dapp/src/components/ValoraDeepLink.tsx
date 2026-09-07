"use client";
import { useEffect } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { isValoraBrowser } from "@/lib/valora";

// Valora's WalletConnect deep link. From the WalletConnect registry, Valora's
// mobile native scheme is `celo://wallet`; WalletConnect's own deep-link format is
// `<scheme>/wc?uri=<encoded pairing uri>` — i.e. celo://wallet/wc?uri=… (note the
// slash before `wc`). This is exactly the link WalletConnect uses when you tap
// Valora in its list, so it routes into Valora and pairs the session.
const VALORA_WC_DEEPLINK = "celo://wallet/wc?uri=";

// Inside an in-app WebView (≈ Valora for a Celo dapp), WalletConnect's own wallet
// list is suppressed (wagmi `showQrModal: false`), and here we catch the pairing
// URI the connector emits and deep-link it straight into Valora — so "Connect with
// Valora" opens Valora immediately instead of a 30-wallet chooser. Inert everywhere
// else.
export function ValoraDeepLink() {
  useEffect(() => {
    if (!isValoraBrowser()) return;
    const wc = wagmiConfig.connectors.find((c) => c.id === "walletConnect");
    if (!wc) return;

    const onMessage = (payload: { type?: string; data?: unknown }) => {
      if (payload?.type === "display_uri" && typeof payload.data === "string") {
        window.location.href = VALORA_WC_DEEPLINK + encodeURIComponent(payload.data);
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
