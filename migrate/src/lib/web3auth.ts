"use client";
import type { EIP1193Provider } from "viem";

// Legacy Focus-Pet Web3Auth login. Returns the OLD verified wallet's EIP-1193
// provider so it can sign the account-link transaction and sweep its G$.
//
// ── Why this file is shaped the way it is ────────────────────────────────────
//
// We already collect the email in step 1, so we drive the AUTH connector directly
// with connectTo({ authConnection: "email_passwordless", loginHint }) instead of
// calling connect(). connect() opens Web3Auth's own modal, which asks for the
// same email a second time and makes the user pick "email" from a wallet list
// they never asked for.
//
// The catch: the AUTH connector opens a POPUP (UX_MODE defaults to "popup").
// Browsers only allow window.open() while a user gesture is still on the stack,
// and EVERY `await` before it ends that gesture. So `await init(); await connectTo()`
// gets the popup silently blocked and the SDK then waits forever for a window
// that never opened — an infinite spinner with no error.
//
// Hence: init() runs AHEAD of time (prepareWeb3Auth, fired when the user reaches
// the sign-in step), and loginWeb3Auth() calls connectTo() with NO await before
// it, so the popup opens inside the click. openWeb3AuthModal() is the escape
// hatch if a popup blocker still eats it.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let instance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let consts: { WALLET_CONNECTORS: any; AUTH_CONNECTION: any } | null = null;
let initPromise: Promise<void> | null = null;
let cached: EIP1193Provider | null = null;

/**
 * Import + init the SDK ahead of the click. Safe to call repeatedly; the work
 * happens once. Call this as soon as you know Web3Auth will be needed.
 */
export function prepareWeb3Auth(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = await import("@web3auth/modal");
    const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;
    if (!clientId) throw new Error("Web3Auth client ID not configured");

    const w3a = new mod.Web3Auth({
      clientId,
      web3AuthNetwork: "sapphire_mainnet",
      // Chain config is managed in the Web3Auth dashboard for this client ID.
    } as ConstructorParameters<typeof mod.Web3Auth>[0]);

    await w3a.init();
    instance = w3a;
    consts = {
      WALLET_CONNECTORS: mod.WALLET_CONNECTORS,
      AUTH_CONNECTION: mod.AUTH_CONNECTION,
    };
  })().catch((e) => {
    initPromise = null; // let a later attempt retry
    throw e;
  });
  return initPromise;
}

async function providerToAccount(provider: EIP1193Provider) {
  cached = provider;
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Web3Auth returned no wallet");
  return { provider, address: address.toLowerCase() };
}

export class PopupBlockedError extends Error {
  constructor() {
    super("Web3Auth's sign-in window didn't open — your browser may have blocked the popup.");
    this.name = "PopupBlockedError";
  }
}

/**
 * Headless email sign-in. MUST be called directly from a click handler with no
 * awaits in front of it, or the popup will be blocked (see the note above).
 */
export async function loginWeb3Auth(
  email?: string,
): Promise<{ provider: EIP1193Provider; address: string }> {
  const trimmed = email?.trim();

  // Not prepared yet (user clicked faster than init, or prepare failed). We can't
  // preserve the gesture through init(), so send them to the modal — which opens
  // its popup from its own fresh click and is therefore never blocked.
  if (!instance || !consts || !trimmed) {
    return openWeb3AuthModal();
  }

  // Already signed in from an earlier attempt.
  if (instance.connected && instance.provider) {
    return providerToAccount(instance.provider as EIP1193Provider);
  }

  // ⚠️ No `await` above this line — the popup opens inside the user gesture.
  const connecting = instance.connectTo(consts.WALLET_CONNECTORS.AUTH, {
    authConnection: consts.AUTH_CONNECTION.EMAIL_PASSWORDLESS,
    loginHint: trimmed,
  }) as Promise<EIP1193Provider | null>;

  let provider: EIP1193Provider | null;
  try {
    provider = await connecting;
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (/popup|blocked|window/i.test(msg)) throw new PopupBlockedError();
    throw e;
  }
  if (!provider) throw new Error("Web3Auth login was cancelled");

  return providerToAccount(provider);
}

/**
 * Fallback: Web3Auth's own modal. Costs the user an extra email entry, but its
 * popup is opened by a click inside the modal, so it survives popup blockers.
 */
export async function openWeb3AuthModal(): Promise<{ provider: EIP1193Provider; address: string }> {
  await prepareWeb3Auth();
  if (instance.connected && instance.provider) {
    return providerToAccount(instance.provider as EIP1193Provider);
  }
  const provider = (await instance.connect()) as unknown as EIP1193Provider | null;
  if (!provider) throw new Error("Web3Auth login was cancelled");
  return providerToAccount(provider);
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
    consts = null;
    initPromise = null;
    cached = null;
  }
}
