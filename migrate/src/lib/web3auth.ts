"use client";
import type { EIP1193Provider } from "viem";

// Legacy Focus-Pet Web3Auth login. Returns the OLD verified wallet's EIP-1193
// provider so it can sign the account-link transaction and sweep its G$.
//
// Web3Auth's modal SDK is browser-only and heavy, so it's dynamically imported
// on demand — it never touches the initial bundle or the SSR pass.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let instance: any = null;
let cached: EIP1193Provider | null = null;

/**
 * Log in to the legacy Web3Auth wallet.
 *
 * We already collected the email in step 1, so we drive the AUTH connector
 * DIRECTLY with `connectTo(..., { authConnection: "email_passwordless", loginHint })`
 * rather than calling `connect()`. `connect()` opens Web3Auth's own modal, which
 * asks for the email a second time — the user has to type the same address twice
 * and pick "email" from a wallet list they never asked for.
 *
 * `Web3Auth extends Web3AuthNoModal`, so connectTo() is available on the modal
 * build; passing loginHint sends the OTP straight to the address we already have.
 * If anything about the headless path fails we fall back to the modal rather than
 * dead-ending the migration.
 */
export async function loginWeb3Auth(
  email?: string,
): Promise<{ provider: EIP1193Provider; address: string }> {
  const { Web3Auth, WALLET_CONNECTORS, AUTH_CONNECTION } = await import("@web3auth/modal");

  const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;
  if (!clientId) throw new Error("Web3Auth client ID not configured");

  const web3auth = new Web3Auth({
    clientId,
    web3AuthNetwork: "sapphire_mainnet",
    // Chain config is managed in the Web3Auth dashboard for this client ID;
    // we connect and read the resulting EIP-1193 provider.
  } as ConstructorParameters<typeof Web3Auth>[0]);

  await web3auth.init();
  instance = web3auth;

  let provider: EIP1193Provider | null = null;

  const trimmed = email?.trim();
  if (trimmed) {
    try {
      provider = (await web3auth.connectTo(WALLET_CONNECTORS.AUTH, {
        authConnection: AUTH_CONNECTION.EMAIL_PASSWORDLESS,
        loginHint: trimmed,
      })) as unknown as EIP1193Provider | null;
    } catch (e) {
      // Cancelled by the user, or the connector rejected the hint. Fall through
      // to the modal so they always have a way in.
      console.warn("[web3auth] headless email login failed, falling back to modal", e);
      provider = null;
    }
  }

  if (!provider) {
    provider = (await web3auth.connect()) as unknown as EIP1193Provider | null;
  }
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

/** Full sign-out: ends the Web3Auth session and drops the cached provider. */
export async function logoutWeb3Auth(): Promise<void> {
  try {
    if (instance?.connected) await instance.logout();
  } catch {
    /* already logged out, or never initialised */
  } finally {
    instance = null;
    cached = null;
  }
}
