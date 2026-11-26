import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let w: typeof import("@/lib/withdrawInfo");
const fetchMock = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  w = await import("@/lib/withdrawInfo");
});
afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b)));

describe("pure helpers", () => {
  it("reads the rate from a quote, after our 1%", () => {
    expect(w.nairaPerGFromQuote({ receive: { naira: 16_000 } })).toBeCloseTo(0.1584);
    for (const bad of [null, {}, { receive: {} }, { receive: { naira: 0 } }, { receive: { naira: "x" } }]) expect(w.nairaPerGFromQuote(bad)).toBeNull();
  });
  it("knows Nigeria by country or Lagos time", () => {
    expect(w.isNigeria("NG", "Europe/London")).toBe(true);
    expect(w.isNigeria(null, "Africa/Lagos")).toBe(true);
    expect(w.isNigeria("GB", "Europe/London")).toBe(false);
  });
  it("rounds naira down: never promise more than the bank pays", () => {
    expect(w.nairaFor(1000, 0.15999)).toBe(159);
  });
});

describe("getWithdrawInfo", () => {
  it("asks once per page view and shares the answer", async () => {
    fetchMock.mockImplementation((url: string) => json(url.includes("probe") ? { enabled: true, country: "NG" } : { receive: { naira: 16_000 } }));
    const [a, b] = await Promise.all([w.getWithdrawInfo(), w.getWithdrawInfo()]);
    expect(a).toEqual({ enabled: true, paused: false, inNigeria: true, nairaPerG: expect.closeTo(0.1584) });
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one probe, one quote
    expect(w.peekWithdrawInfo()).toEqual(a);
  });
  it("skips the rate when withdrawals are off", async () => {
    fetchMock.mockImplementation(() => json({ enabled: false, country: "NG" }));
    expect(await w.getWithdrawInfo()).toMatchObject({ enabled: false, nairaPerG: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("while paused keeps the button but skips the rate", async () => {
    fetchMock.mockImplementation(() => json({ enabled: true, paused: true, country: "NG" }));
    expect(await w.getWithdrawInfo()).toMatchObject({ enabled: true, paused: true, nairaPerG: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("never rejects, and retries after a failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await w.getWithdrawInfo()).toMatchObject({ enabled: false, nairaPerG: null });
    fetchMock.mockImplementation((url: string) => json(url.includes("probe") ? { enabled: true, country: "GB" } : { receive: { naira: 10_000 } }));
    expect(await w.getWithdrawInfo()).toMatchObject({ enabled: true });
  });
});
