import { describe, expect, it } from "vitest";
import { fitFontSize, formatNairaWhole, winShareText, wrapLines } from "@/lib/winCard";

// A fake measure: every character is (font size / 2) px wide.
const measure = (text: string, font: string) => text.length * (Number(/(\d+)px/.exec(font)?.[1]) / 2);
const F = `500 40px x`; // 20 px per character

describe("fitFontSize", () => {
  it("keeps the largest size that fits, never below the minimum", () => {
    expect(fitFontSize(measure, "12345", 700, 300, 120, 2000)).toBe(300);
    expect(fitFontSize(measure, "1234567890", 700, 300, 120, 1000)).toBeLessThanOrEqual(200);
    expect(fitFontSize(measure, "x".repeat(200), 700, 300, 120, 100)).toBe(120);
  });
});

describe("wrapLines", () => {
  it("wraps on words within the width", () => {
    expect(wrapLines(measure, "one two three", F, 180, 2)).toEqual(["one two", "three"]); // 9 chars max
  });
  it("cuts to the line limit with an ellipsis that still fits", () => {
    const lines = wrapLines(measure, "aaa bbb ccc ddd eee fff", F, 140, 2); // 7 chars max
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const l of lines) expect(measure(l, F)).toBeLessThanOrEqual(140);
  });
  it("shortens a single word longer than the line", () => {
    const [l] = wrapLines(measure, "Supercalifragilistic", F, 100, 2);
    expect(l.endsWith("…")).toBe(true);
    expect(measure(l, F)).toBeLessThanOrEqual(100);
  });
  it("returns nothing for empty text", () => {
    expect(wrapLines(measure, "   ", F, 100, 2)).toEqual([]);
  });
});

describe("share text", () => {
  it("formats whole naira with Nigerian grouping", () => {
    expect(formatNairaWhole(1550.9)).toBe("₦1,550");
  });
  it("adds the naira value only when known", () => {
    const amount = 1000n * 10n ** 18n;
    expect(winShareText({ amount, naira: 1550 })).toContain("(that's ₦1,550)");
    expect(winShareText({ amount, naira: null })).not.toContain("₦");
    expect(winShareText({ amount, naira: 0 })).not.toContain("₦");
  });
});

describe("formatWholeG", () => {
  it("never abbreviates: the card shows the exact amount", async () => {
    const { formatWholeG } = await import("@/lib/winCard");
    expect(formatWholeG(1000n * 10n ** 18n)).toBe("1,000");
    expect(formatWholeG(250_000n * 10n ** 18n)).toBe("250,000");
    expect(formatWholeG(125n * 10n ** 17n)).toBe("12.5");
  });
});
