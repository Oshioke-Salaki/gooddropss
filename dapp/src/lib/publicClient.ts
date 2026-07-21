import { createPublicClient, fallback, http } from "viem";
import { celo } from "viem/chains";

// The identity/verification check fans out into several eth_calls. Two things keep
// it fast and reliable on the claim screen:
//   • multicall batching — concurrent reads collapse into ONE round-trip instead
//     of one-per-call against a slow public RPC.
//   • a ranked fallback — forno.celo.org rate-limits and slows down under load;
//     `rank` periodically measures latency and prefers the fastest healthy RPC,
//     and any hard error falls through to the next.
export const publicClient = createPublicClient({
  chain: celo,
  transport: fallback(
    [
      http("https://forno.celo.org"),
      http("https://celo.drpc.org"),
      http("https://rpc.ankr.com/celo"),
    ],
    { rank: { interval: 60_000, sampleCount: 3 } },
  ),
  batch: { multicall: { wait: 16 } },
});
