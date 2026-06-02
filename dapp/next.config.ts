import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevents react-leaflet's "Map container is already initialized" in dev
  reactStrictMode: false,
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @metamask/sdk imports a React Native package that doesn't exist in web builds
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    return config;
  },
};

export default nextConfig;
