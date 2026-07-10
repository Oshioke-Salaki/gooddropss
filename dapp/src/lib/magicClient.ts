"use client";
import { Magic } from "magic-sdk";

const CELO_RPC = "https://forno.celo.org";

// A standalone Magic instance that shares its session with the wagmi Magic
// connector (Magic sessions are scoped per apiKey + origin). This lets us collect
// the email in our own UI and log in headlessly; wagmi's connect() then sees the
// session as already-authorized and skips the connector's built-in modal.
let instance: Magic | null = null;

export function getMagic(): Magic | null {
  if (typeof window === "undefined") return null;
  if (!instance) {
    const key = process.env.NEXT_PUBLIC_MAGIC_KEY;
    if (!key) return null;
    instance = new Magic(key, {
      network: { rpcUrl: CELO_RPC, chainId: 42220 },
    });
  }
  return instance;
}
