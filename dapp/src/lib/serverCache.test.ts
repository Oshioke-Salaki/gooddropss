import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let memo: typeof import("@/lib/serverCache").memo;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  memo = (await import("@/lib/serverCache")).memo;
});
afterEach(() => vi.useRealTimers());

describe("memo", () => {
  it("reuses a value within its TTL and shares one in-flight load", async () => {
    const load = vi.fn(async () => 1);
    await Promise.all([memo("k", 1_000, load), memo("k", 1_000, load)]);
    await memo("k", 1_000, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("`fresh` rebuilds, but not more than once every 3 s", async () => {
    let n = 0;
    const load = vi.fn(async () => ++n);
    expect(await memo("k", 60_000, load)).toBe(1);
    expect(await memo("k", 60_000, load, { fresh: true })).toBe(1); // built just now
    vi.advanceTimersByTime(3_100);
    expect(await memo("k", 60_000, load, { fresh: true })).toBe(2);
  });

  it("serves the stale value when a rebuild fails, and doesn't cache failures", async () => {
    const load = vi.fn<() => Promise<number>>().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(3);
    await memo("k", 1_000, load);
    vi.advanceTimersByTime(1_100);
    expect(await memo("k", 1_000, load)).toBe(1);
    expect(await memo("k", 1_000, load)).toBe(3);
  });
});
