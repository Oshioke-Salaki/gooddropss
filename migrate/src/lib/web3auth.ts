"use client";
import type { EIP1193Provider } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

    // MUST match the network the legacy Focus-Pet client ID was registered under.
    // It's not just an init check: Web3Auth derives the wallet address from
    // (clientId, network, login), so the wrong network would (a) refuse to boot —
    // "Network mismatch … does not match project network sapphire_mainnet" — and
    // (b) if it did boot, derive a DIFFERENT address than the user's real wallet.
    // The Focus-Pet project lives on sapphire_mainnet (confirmed in the Web3Auth /
    // MetaMask developer dashboard, client ID BBsmG9D18eB6…); keep it overridable
    // in case the project is ever migrated.
    const web3AuthNetwork =
      (process.env.NEXT_PUBLIC_WEB3AUTH_NETWORK as
        | "sapphire_devnet" | "sapphire_mainnet"
        | undefined) ?? "sapphire_mainnet";

    const w3a = new mod.Web3Auth({
      clientId,
      web3AuthNetwork,
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

  // Web3Auth exposes the embedded wallet's raw key. We use it to sign Celo
  // transactions LOCALLY and broadcast them via Forno, instead of routing through
  // Web3Auth's wallet-services relayer (api-wallet.web3auth.io) — that relayer
  // isn't configured for Celo and 400s every transaction. The key never leaves
  // the browser; it's the user's own wallet, for a migration they initiated.
  // eth_private_key / private_key are Web3Auth-specific RPC methods, not part of
  // viem's typed EIP-1193 surface — call through an untyped request.
  const rawRequest = (provider as unknown as {
    request: (a: { method: string }) => Promise<unknown>;
  }).request;

  let privateKey: string | null = null;
  for (const method of ["eth_private_key", "private_key"]) {
    try {
      const pk = (await rawRequest({ method })) as string;
      if (pk) { privateKey = pk.startsWith("0x") ? pk : `0x${pk}`; break; }
    } catch { /* try the next method; caller handles a null key */ }
  }

  // Only trust a key that actually derives the funded address. Two ways it can
  // fail to:
  //   • Key export is disabled on the project (common on MAINNET projects) —
  //     eth_private_key throws/returns empty, so privateKey stays null.
  //   • Account abstraction — eth_accounts is a smart-account address while the
  //     key is its EOA signer, so the derived address differs.
  // In either case, signing locally with this key would send from the WRONG
  // (empty) address and fail with a misleading "insufficient funds". Drop it so
  // the caller can report the real problem instead of guessing about gas.
  if (privateKey) {
    try {
      const derived = privateKeyToAccount(privateKey as `0x${string}`).address.toLowerCase();
      if (derived !== address.toLowerCase()) {
        console.error("[web3auth] exported key does not control the wallet address", {
          walletAddress: address.toLowerCase(), derivedFromKey: derived,
        });
        privateKey = null;
      }
    } catch (e) {
      console.error("[web3auth] exported key is not a valid private key", e);
      privateKey = null;
    }
  } else {
    console.error(
      "[web3auth] no private key available for this wallet — key export is likely " +
      "disabled on the Web3Auth project (Wallet Services → Key Export). Local Celo " +
      "signing needs it; the transaction relayer is not Celo-compatible.",
    );
  }

  return { provider, address: address.toLowerCase(), privateKey };
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
): Promise<{ provider: EIP1193Provider; address: string; privateKey: string | null }> {
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
export async function openWeb3AuthModal(): Promise<{ provider: EIP1193Provider; address: string; privateKey: string | null }> {
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
