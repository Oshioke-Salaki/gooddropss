import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds set NEXT_DIST_DIR=.next-verify so they never clobber the
  // .next directory a running `npm run dev` server is actively serving from.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Prevents react-leaflet's "Map container is already initialized" in dev
  reactStrictMode: false,
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @metamask/sdk imports a React Native package that doesn't exist in web builds
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    config.resolve.alias["@farcaster/mini-app-solana"] = false;
    return config;
  },
};

export default nextConfig;
