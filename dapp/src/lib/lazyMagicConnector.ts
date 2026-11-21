"use client";
import type { CreateConnectorFn } from "wagmi";
import { hadSavedSession } from "@/hooks/useSessionRestore";
import type { DedicatedWalletConnectorParams } from "@magiclabs/wagmi-connector";

// A wagmi connector for Magic (email / Google wallets) that only loads Magic
// when it's actually needed.
//
// Why: the stock connector builds a Magic instance the moment it's created, and
// since magic-sdk 21 the constructor preloads Magic's iframe app by default
// (docs.magic.link, "deferPreload"). wagmi's reconnect also calls getProvider()
// and isAuthorized() on every connector at page load. Together that made EVERY
// visitor download Magic and its iframe, signed in or not.
//
// This wrapper keeps the same id / name / type and delegates every call to the
// real connector, loaded on first need:
//   • a browser that has used this connector before (wagmi's own records):
//     loaded at once on page load, so session restore is exactly as before;
//   • someone tapping Sign in (connect), or code asking for the Magic SDK
//     (sign-in modal, Google return page, switch/renew flows): loaded then;
//   • a browser that never used it: getProvider() answers "none", the same
//     way the injected connector does with no browser wallet, so reconnect
//     skips it and nothing is downloaded.

type RealConnector = Record<string, unknown> & {
  magic?: MagicLike;
  connect: (p?: unknown) => Promise<unknown>;
  disconnect: () => Promise<void>;
  getAccounts: () => Promise<readonly `0x${string}`[]>;
  getChainId: () => Promise<number>;
  getProvider: () => Promise<unknown>;
  isAuthorized: () => Promise<boolean>;
  switchChain?: (p: { chainId: number }) => Promise<unknown>;
  onAccountsChanged: (a: string[]) => void;
  onChainChanged: (c: string) => void;
  onDisconnect: (e?: unknown) => void;
};

/** The parts of the Magic SDK our code calls. */
export type MagicLike = {
  preload?: () => Promise<void>;
  auth?: { loginWithEmailOTP: (o: { email: string; showUI: boolean }) => Promise<unknown> };
  oauth2?: {
    loginWithRedirect: (o: { provider: string; redirectURI: string }) => Promise<unknown>;
    getRedirectResult: (o?: object) => Promise<unknown>;
  };
  user?: { isLoggedIn: () => Promise<boolean>; logout: () => Promise<unknown> };
};

/** What our own code may call on a lazy Magic connector (beyond wagmi's API). */
export type LazyMagicExtras = {
  /** Load the real connector (if needed) and return its Magic SDK. */
  getMagic: () => Promise<MagicLike | undefined>;
  /** Start loading Magic now (e.g. when the sign-in sheet opens). */
  warm: () => void;
};

/** Has this browser used the connector `id` before, per wagmi's own storage? */
export function usedBefore(id: string): boolean {
  try {
    const recent = JSON.parse(localStorage.getItem("wagmi.recentConnectorId") || "null");
    if (recent === id) return true;
    const conns = JSON.parse(localStorage.getItem("wagmi.store") || "null")?.state?.connections?.value;
    if (Array.isArray(conns) && conns.some((c: unknown[]) => (c?.[1] as { connector?: { id?: string } })?.connector?.id === id)) return true;
    // Set by the Magic connector while a Google redirect is completing.
    if (id === "magic" && localStorage.getItem("magicRedirectResult")) return true;
  } catch { /* storage blocked: treat as unused */ }
  return false;
}

export function lazyMagicConnector({ id, name, options }: {
  id: string;
  name: string;
  options: DedicatedWalletConnectorParams["options"];
}): CreateConnectorFn {
  return ((config: Parameters<CreateConnectorFn>[0]) => {
    let real: RealConnector | null = null;
    let loading: Promise<RealConnector> | null = null;

    const load = (): Promise<RealConnector> => {
      if (real) return Promise.resolve(real);
      loading ??= import("@magiclabs/wagmi-connector")
        .then(({ dedicatedWalletConnector }) => {
          const factory = dedicatedWalletConnector({ chains: config.chains as never, options }) as unknown as (
            c: typeof config,
          ) => RealConnector;
          // Same `this` for the real connector's own method calls, with our id/name.
          const r = factory(config);
          real = Object.assign(r, { id, name });
          return real;
        })
        .catch((e) => { loading = null; throw e; }); // a failed download can be retried
      return loading;
    };

    // Load up front only for a browser that used this connector AND still has a
    // session to restore; someone who signed out doesn't download Magic again
    // until they sign in.
    const needed = () => !!real || (usedBefore(id) && hadSavedSession());

    return {
      id,
      name,
      type: "Magic",
      async getMagic() { return (await load()).magic; },
      warm() { void load().then((r) => r.magic?.preload?.().catch(() => {})).catch(() => {}); },

      async connect(params?: unknown) { return (await load()).connect(params); },
      async disconnect() {
        if (!needed()) return;
        await (await load()).disconnect();
      },
      async getAccounts() { return (await load()).getAccounts(); },
      async getChainId() { return (await load()).getChainId(); },
      async getProvider() {
        // Never used here and not asked to sign in: no provider, so wagmi's
        // reconnect moves on without loading Magic.
        if (!needed()) return undefined;
        return (await load()).getProvider();
      },
      async isAuthorized() {
        if (!needed()) return false;
        return (await load()).isAuthorized();
      },
      async switchChain(p: { chainId: number }) {
        const r = await load();
        if (!r.switchChain) throw new Error("Switching networks isn't supported for this sign-in.");
        return r.switchChain(p);
      },
      onAccountsChanged(a: string[]) { real?.onAccountsChanged(a); },
      onChainChanged(c: string) {
        if (real) real.onChainChanged(c);
        else config.emitter.emit("change", { chainId: Number(c) });
      },
      onDisconnect() { config.emitter.emit("disconnect"); },
    } as unknown as ReturnType<CreateConnectorFn>;
  }) as unknown as CreateConnectorFn;
}

/**
 * The Magic SDK behind a wagmi connector, loading it on first use. Returns
 * undefined (never throws) when the connector isn't a Magic one or Magic can't
 * be loaded, so callers show their own "unavailable" message.
 */
export async function magicOf<T = MagicLike>(connector: unknown): Promise<T | undefined> {
  const lazy = connector as Partial<LazyMagicExtras> | undefined;
  try { return (await lazy?.getMagic?.()) as T | undefined; } catch { return undefined; }
}
