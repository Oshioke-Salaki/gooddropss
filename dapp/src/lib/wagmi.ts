import { createConfig } from "@privy-io/wagmi";
import { celo } from "viem/chains";
import { http } from "wagmi";

export const wagmiConfig = createConfig({
  chains: [celo],
  transports: {
    [celo.id]: http("https://forno.celo.org"),
  },
});
