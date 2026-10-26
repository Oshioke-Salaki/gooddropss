import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shareOrCopy } from "./share";

function setup(opts: { coarse: boolean; share?: (d: unknown) => Promise<void> }) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: opts.coarse }) });
  vi.stubGlobal("navigator", { share: opts.share, clipboard: { writeText } });
  return { writeText };
}

describe("shareOrCopy", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("copies on desktop even when navigator.share exists (Brave)", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const { writeText } = setup({ coarse: false, share });
    expect(await shareOrCopy({ url: "https://x.y/p" })).toBe("copied");
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("https://x.y/p");
  });

  it("uses the share sheet on phones", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setup({ coarse: true, share });
    expect(await shareOrCopy({ url: "https://x.y/p" })).toBe("shared");
  });

  it("does nothing when the person cancels the sheet", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
    const { writeText } = setup({ coarse: true, share });
    expect(await shareOrCopy({ url: "u" })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to copying when the sheet refuses", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    const { writeText } = setup({ coarse: true, share });
    expect(await shareOrCopy({ text: "hi", url: "u" })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("hi u");
  });
});
