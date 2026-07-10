import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds set NEXT_DIST_DIR=.next-verify so they never clobber a
  // running dev server's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Wallet SDKs (Web3Auth, Magic) reference optional native deps that don't
  // exist in the browser bundle — mark them external so the build doesn't choke.
  webpack: (config) => {
    config.externals = config.externals || [];
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // React-Native-only optional dep pulled transitively by @metamask/sdk
    // (via @web3auth/modal) — alias to an empty module so the browser build
    // doesn't fail to resolve it.
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // Optional peer deps of @metamask/sdk and @privy-io/react-auth that our
      // email-only flow never touches — alias to empty so the browser build is
      // warning-free.
      "@react-native-async-storage/async-storage": false,
      "@farcaster/mini-app-solana": false,
      "@stripe/crypto": false,
    };
    return config;
  },
};

export default nextConfig;
