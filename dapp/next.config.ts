import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds set NEXT_DIST_DIR=.next-verify so they never clobber the
  // .next directory a running `npm run dev` server is actively serving from.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Prevents react-leaflet's "Map container is already initialized" in dev
  reactStrictMode: false,
  // Baseline hardening. Deliberately no X-Frame-Options / frame-ancestors: the
  // app runs inside wallet browsers (MiniPay, Valora) that embed it.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @metamask/sdk imports a React Native package that doesn't exist in web builds
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    config.resolve.alias["@farcaster/mini-app-solana"] = false;
    return config;
  },
};

export default nextConfig;
