import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Money-path tests against a LOCAL fork of Celo mainnet (anvil). Nothing is
// broadcast to the real chain; see e2e-chain/README.md. Run with `npm run e2e:chain`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["e2e-chain/**/*.test.ts"],
    globalSetup: ["e2e-chain/anvil.setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
