import { afterEach, describe, expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";

const base = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: {} }] } as unknown as StyleSpecification;

async function load(ok = true) {
  vi.resetModules();
  const fetchMock = vi.fn(async () => (ok ? new Response(JSON.stringify(base)) : new Response("", { status: 500 })));
  vi.stubGlobal("fetch", fetchMock);
  return { ...(await import("./styleFor")), fetchMock };
}
afterEach(() => vi.unstubAllGlobals());

describe("styleFor", () => {
  it("sets the globe projection inside the style, and fetches the base style once", async () => {
    const { styleFor, fetchMock } = await load();
    const flat = await styleFor("original") as StyleSpecification;
    const globe = await styleFor("night", { globe: true }) as StyleSpecification;
    expect(flat.projection).toBeUndefined();
    expect(globe.projection).toEqual({ type: "globe" });
    expect(globe.name).toBe("GoodDrops Night");
    expect(((await styleFor("midnight")) as StyleSpecification).name).toBe("GoodDrops Midnight");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the style URL (the map still loads) when the fetch fails", async () => {
    const { styleFor } = await load(false);
    expect(await styleFor("night", { globe: true })).toMatch(/^https:\/\//);
  });
});
