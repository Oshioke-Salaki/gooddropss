import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// HTTP-level tests against a running server backed by a THROWAWAY Redis.
// Never point E2E_API_BASE at production. See e2e-api/README.md.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["e2e-api/**/*.test.ts"], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
});
