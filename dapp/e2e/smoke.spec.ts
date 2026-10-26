import { test, expect, type Page } from "@playwright/test";

// Real records so the dynamic routes exercise their data paths. Override with
// env vars if these ever disappear from the subgraph.
const HUNTER = process.env.E2E_HUNTER ?? "0xc2c2885a36ccf297bea31be2ff2fdc13101b21f1";
const DROP = process.env.E2E_DROP ?? "8697";

const ROUTES = [
  "/", "/leaderboard", "/competition", "/merchant", "/sponsor", "/me", "/my-drops",
  `/hunter/${HUNTER}`, `/drop/${DROP}`, `/drop/${DROP}/sticker`, "/admin",
];

// Console noise we can't act on: third-party wallet/analytics scripts, and
// resource 404s (covered by the status assertions instead).
const NOISE = [
  /Failed to load resource/i,
  /walletconnect|web3modal|magic\.link|magic-sdk|reown/i,
  /vercel-scripts|_vercel\/insights|speed-insights/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
];

async function skipWelcome(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem("gd_onboarded", "1"); } catch { /* private mode */ } });
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!NOISE.some((r) => r.test(t))) errors.push(`console: ${t.slice(0, 300)}`);
  });
  return errors;
}

for (const [label, width, height] of [["phone", 390, 844], ["desktop", 1440, 900]] as const) {
  test.describe(label, () => {
    test.use({ viewport: { width, height }, isMobile: label === "phone", hasTouch: label === "phone" });

    for (const route of ROUTES) {
      test(`${route} renders cleanly`, async ({ page }) => {
        await skipWelcome(page);
        const errors = collectErrors(page);
        const res = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(res?.status(), `HTTP status for ${route}`).toBe(200);
        // Let client data land and hydration settle.
        await page.waitForTimeout(4000);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "horizontal overflow (px)").toBeLessThanOrEqual(0);
        expect(errors, "console / page errors").toEqual([]);
      });
    }
  });
}

test("sign-in sheet opens from the nav", async ({ page }) => {
  await skipWelcome(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/leaderboard", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^sign in$/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("onboarding welcome can be skipped", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: /^skip$/i });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(skip).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("gd_onboarded"))).not.toBeNull();
});

test("unknown routes show the 404 page", async ({ page }) => {
  await skipWelcome(page);
  const res = await page.goto("/this-page-does-not-exist", { waitUntil: "domcontentloaded" });
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /nothing hidden here/i })).toBeVisible();
});
