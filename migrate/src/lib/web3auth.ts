"use client";
import type { EIP1193Provider } from "viem";

// Legacy Focus-Pet Web3Auth login. Returns the OLD verified wallet's EIP-1193
// provider so it can sign the account-link transaction and sweep its G$.
//
// Web3Auth's modal SDK is browser-only and heavy, so it's dynamically imported
// on demand — it never touches the initial bundle or the SSR pass.

let cached: EIP1193Provider | null = null;

export async function loginWeb3Auth(): Promise<{ provider: EIP1193Provider; address: string }> {
  const { Web3Auth } = await import("@web3auth/modal");

  const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;
  if (!clientId) throw new Error("Web3Auth client ID not configured");

  const web3auth = new Web3Auth({
    clientId,
    web3AuthNetwork: "sapphire_mainnet",
    // Chain config is managed in the Web3Auth dashboard for this client ID;
    // we connect and read the resulting EIP-1193 provider.
  } as ConstructorParameters<typeof Web3Auth>[0]);

  await web3auth.init();
  const provider = (await web3auth.connect()) as unknown as EIP1193Provider | null;
  if (!provider) throw new Error("Web3Auth login was cancelled");
  cached = provider;

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Web3Auth returned no wallet");

  return { provider, address: address.toLowerCase() };
}

export function getCachedWeb3AuthProvider(): EIP1193Provider | null {
  return cached;
}
