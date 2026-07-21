import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

// Multicall batching is the real speed win for the identity/verification checks —
// concurrent eth_call reads collapse into ONE round-trip. We deliberately use a
// SINGLE reliable transport (forno) rather than a ranked fallback: the drpc/ankr
// public endpoints intermittently return HTTP 400 on real methods, and with a
// ranked fallback viem would pick a "fast-pinging but broken" endpoint and blow up
// waitForTransactionReceipt (and every other write). Forno is stable; transient
// blips are handled by per-query retries where it matters (see useIdentityStatus).
export const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
  batch: { multicall: { wait: 16 } },
});
