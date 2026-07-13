import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { celo } from "viem/chains";
import { injected } from "wagmi/connectors";
import { dedicatedWalletConnector } from "@magiclabs/wagmi-connector";

const CELO_RPC = "https://forno.celo.org";

// Magic (email → embedded Celo wallet) is the primary connector; `injected`
// keeps external wallets (MetaMask, MiniPay, Brave…) working. Both are standard
// wagmi v2 connectors, so every useAccount / useReadContract / useWriteContract /
// useWalletClient call in the app keeps working unchanged.
// `injected` is safe on the server; the Magic connector instantiates magic-sdk
// (which reads `window`) at construction, so it's only added on the client. The
// server never needs it — connect() only ever runs in the browser.
const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];

if (typeof window !== "undefined") {
  connectors.unshift(
    // v2.3.2 of the connector was built against an older wagmi, so its connect()
    // return type drifts from the current CreateConnectorFn (runtime is fine).
    dedicatedWalletConnector({
      chains: [celo],
      options: {
        apiKey: process.env.NEXT_PUBLIC_MAGIC_KEY as string,
        magicSdkConfiguration: {
          network: { rpcUrl: CELO_RPC, chainId: celo.id },
        },
        enableEmailLogin: true,
        // NOTE: deliberately no `oauthOptions`. The connector's built-in Google
        // button hardcodes `redirectURI: window.location.href`, which varies per
        // page and always fails Google's exact-match redirect_uri check. We drive
        // Google ourselves from AuthModal against a single fixed /auth/callback
        // URL instead. The connector's Magic instance always includes
        // OAuthExtension, so `magic.oauth2` is available regardless of this option.
      },
    }) as unknown as CreateConnectorFn,
  );
}

export const wagmiConfig = createConfig({
  chains: [celo],
  ssr: true,
  transports: {
    [celo.id]: http(CELO_RPC),
  },
  connectors,
});
