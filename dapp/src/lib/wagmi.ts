import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { celo } from "viem/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { lazyMagicConnector } from "@/lib/lazyMagicConnector";
import { VALORA_WC_ID, isValoraBrowser } from "@/lib/valora";
import { PARTNER, PARTNER_CONNECTOR_ID } from "@/lib/partner";

const CELO_RPC = "https://forno.celo.org";

// Magic (email → embedded Celo wallet) is the primary connector; `injected`
// keeps external wallets (MetaMask, MiniPay, Brave…) working. Both are standard
// wagmi v2 connectors, so every useAccount / useReadContract / useWriteContract /
// useWalletClient call in the app keeps working unchanged.
// `injected` is safe on the server; the Magic connectors touch `window`, so
// they're only added on the client. The server never needs them.
const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];

if (typeof window !== "undefined") {
  // Magic (email / Google) — loaded lazily: see lib/lazyMagicConnector. A browser
  // that never signed in with Magic doesn't download it or its iframe app.
  connectors.unshift(
    lazyMagicConnector({
      id: "magic",
      name: "Magic",
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
    }),
  );

  // Partner sign-in — a SECOND Magic connector built with the partner's
  // publishable key, so their users get their existing (verified) wallet here.
  // magic-sdk keys its iframe + session on {API_KEY, origin, network}, so a
  // different key is a fully separate SDK instance; its own id keeps wagmi's
  // lookups and `recentConnectorId` apart from ours. Also loaded lazily.
  if (PARTNER) {
    connectors.splice(1, 0, lazyMagicConnector({
      id: PARTNER_CONNECTOR_ID,
      name: PARTNER.name,
      options: {
        apiKey: PARTNER.key,
        magicSdkConfiguration: { network: { rpcUrl: CELO_RPC, chainId: celo.id } },
        enableEmailLogin: true,
        // Email OTP only. Google via the partner's key would need our callback
        // URL on THEIR redirect allowlist and their OAuth provider enabled.
      },
    }));
  }

  // WalletConnect — lets mobile users connect an existing wallet (Valora, MiniPay,
  // MetaMask, …) straight from a normal browser: it deep-links into the wallet app
  // or shows a QR on desktop. Client-only (it touches window/IndexedDB), and
  // skipped cleanly when the project id is unset so the build never breaks.
  const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  // Inside Valora's browser we hide WalletConnect's own wallet list and deep-link
  // straight into Valora (see ValoraDeepLink); everywhere else the list shows as
  // normal, with Valora pinned to the top.
  const inValora = isValoraBrowser();
  if (wcProjectId) {
    connectors.push(
      walletConnect({
        projectId: wcProjectId,
        // Inside Valora: no list — ValoraDeepLink catches the URI and opens Valora.
        // Elsewhere: WalletConnect's own modal (with Valora recommended at the top).
        showQrModal: !inValora,
        metadata: {
          name: "GoodDrops",
          description: "Hide and hunt real G$ anywhere in the world.",
          url: window.location.origin,
          // 180px icon: Valora shows this on its connect / approve screens, and
          // /icon is only 32px.
          icons: [`${window.location.origin}/apple-icon`],
        },
        // The QR / deep-link modal must render ABOVE our sign-in sheet (z 2000)
        // and session loader (z 3000) — otherwise the popup opens invisibly behind
        // them and the connect just spins (seen inside Valora, and on desktop).
        // `explorerRecommendedWalletIds` pins Valora to the top of the list so our
        // Celo users aren't hunting for it among 30+ other wallets.
        qrModalOptions: {
          themeVariables: { "--wcm-z-index": "2147483000" },
          explorerRecommendedWalletIds: [VALORA_WC_ID],
        },
      }),
    );
  }
}

export const wagmiConfig = createConfig({
  chains: [celo],
  ssr: true,
  transports: {
    [celo.id]: http(CELO_RPC, { batch: true }),
  },
  connectors,
});
