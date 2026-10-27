import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Runs the real public/sw.js against a fake worker scope.
const SRC = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

async function activateWith(existing: string[]) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const store = new Set(existing);
  const tabs = [{ url: "https://www.gooddrops.xyz/", navigate: vi.fn(async () => {}) }];
  const self = {
    addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => tabs) },
    registration: {}, location: { origin: "https://www.gooddrops.xyz" },
  };
  const caches = {
    keys: async () => [...store],
    delete: async (k: string) => store.delete(k),
    open: async () => ({ addAll: async () => {}, put: async () => {} }),
    match: async () => undefined,
  };
  new Function("self", "caches", "clients", SRC)(self, caches, self.clients);
  let done: Promise<unknown> = Promise.resolve();
  handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
  await done;
  return { left: [...store], navigated: tabs[0].navigate.mock.calls.length };
}

describe("service worker activate", () => {
  it("reloads open tabs when replacing a pre-v22 cache-first worker", async () => {
    const r = await activateWith(["gooddrops-v1"]);
    expect(r.navigated).toBe(1);
    expect(r.left).toEqual([]);
  });
  it("leaves tabs alone on a normal upgrade", async () => {
    const r = await activateWith(["gooddrops-v22", "some-other-cache"]);
    expect(r.navigated).toBe(0);
    expect(r.left).toEqual(["gooddrops-v22"]);
  });
  it("leaves tabs alone on a fresh install", async () => {
    expect((await activateWith([])).navigated).toBe(0);
  });
});
