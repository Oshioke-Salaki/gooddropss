import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_ = "https://example.test/subgraph";

async function load() {
  vi.resetModules();
  vi.stubEnv("SUBGRAPH_URL", URL_);
  return import("@/lib/subgraphClient");
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("gql", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns data and sends the query with a timeout signal", async () => {
    const { gql } = await load();
    fetchMock.mockResolvedValueOnce(json({ data: { ok: 1 } }));
    await expect(gql("{ ok }", { a: 1 })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_);
    expect(JSON.parse(init.body)).toEqual({ query: "{ ok }", variables: { a: 1 } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.cache).toBe("no-store");
  });

  it("throws GraphQL errors instead of returning empty data", async () => {
    const { gql, SubgraphError } = await load();
    fetchMock.mockResolvedValueOnce(json({ errors: [{ message: "bad field" }] }));
    await expect(gql("{ x }")).rejects.toBeInstanceOf(SubgraphError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // a bad query is never retried
  });

  it("retries a rate limit (429), honouring Retry-After, then succeeds", async () => {
    const { gql } = await load();
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "1" }))
      .mockResolvedValueOnce(json({ data: { ok: 2 } }));
    const p = gql("{ ok }");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p).resolves.toEqual({ ok: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries network failures and 5xx, then gives up with an error", async () => {
    const { gql } = await load();
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json({}, 502))
      .mockResolvedValueOnce(json({}, 503));
    const p = gql("{ ok }");
    const settled = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("503");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry other 4xx answers", async () => {
    const { gql } = await load();
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await expect(gql("{ ok }")).rejects.toThrow("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast when no URL is configured", async () => {
    vi.resetModules();
    vi.stubEnv("SUBGRAPH_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUBGRAPH_URL", "");
    const { gql } = await import("@/lib/subgraphClient");
    await expect(gql("{ ok }")).rejects.toThrow("not set");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
