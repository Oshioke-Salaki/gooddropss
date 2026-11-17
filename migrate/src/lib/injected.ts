"use client";
import type { EIP1193Provider } from "viem";

const CELO_HEX = "0xa4ec"; // 42220

// EIP-6963 announced provider shape.
interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

// Discover real wallet extensions via EIP-6963. This bypasses `window.ethereum`,
// which Privy (mounted for the legacy email path) can proxy — talking to that
// proxy throws "wallet must have at least one account". Each wallet announces
// its own provider here independently, so we get the genuine MetaMask/MiniPay/etc.
function discoverProviders(timeoutMs = 350): Promise<Eip6963Detail[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve([]);
    const found: Eip6963Detail[] = [];
    const seen = new Set<string>();
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Eip6963Detail>).detail;
      if (detail?.info?.rdns && !seen.has(detail.info.rdns)) {
        seen.add(detail.info.rdns);
        found.push(detail);
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
      resolve(found);
    }, timeoutMs);
  });
}

/**
 * Connect a browser wallet directly (MetaMask, MiniPay, Brave, Rabby, …) so a
 * user whose verified wallet lives in a real wallet can authorize the link.
 * Prefers EIP-6963 discovery (avoids the Privy window.ethereum proxy); falls
 * back to window.ethereum only if no wallet announces itself.
 */
export async function loginInjected(): Promise<{ provider: EIP1193Provider; address: string }> {
  const discovered = await discoverProviders();
  // Never route through Privy's injected shim.
  const wallets = discovered.filter(
    (d) => !/privy/i.test(d.info.rdns) && !/privy/i.test(d.info.name),
  );

  let provider: EIP1193Provider | undefined = wallets[0]?.provider;

  if (!provider) {
    // Fallback: raw window.ethereum (only if no EIP-6963 wallet was announced).
    provider = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  }
  if (!provider) {
    throw new Error("No browser wallet found. Open this page inside your wallet's browser, or install one.");
  }

  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Your wallet didn't share an account. Unlock it and try again.");

  // Ask the wallet to switch to Celo — linking + sweeping happen there.
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CELO_HEX }] });
  } catch {
    // Rejected or Celo not added — the link/sweep tx will surface a clear chain
    // error later; don't block the connect here.
  }

  return { provider, address: address.toLowerCase() };
}
