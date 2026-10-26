import { defineConfig } from "@playwright/test";

// Smoke tests against a running server (local dev by default, or a preview URL
// via E2E_BASE_URL). Uses the installed Chrome, so nothing is downloaded.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // One page at a time: these load the full map and wallet stack, and a dev
  // server compiles routes on first hit. Parallel runs just time each other out.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    headless: true,
    navigationTimeout: 90_000,
  },
});
