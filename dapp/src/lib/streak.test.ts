import { describe, it, expect } from "vitest";
import { effectiveStreak } from "./streak";

const NOW = Date.parse("2026-10-26T12:00:00Z");

describe("effectiveStreak", () => {
  it("keeps a streak whose last claim was today or yesterday", () => {
    expect(effectiveStreak({ current: 4, best: 6, lastDate: "2026-10-26" }, NOW).current).toBe(4);
    expect(effectiveStreak({ current: 4, best: 6, lastDate: "2026-10-25" }, NOW).current).toBe(4);
  });
  it("reads a broken streak as 0 but keeps the best", () => {
    expect(effectiveStreak({ current: 9, best: 9, lastDate: "2026-09-18" }, NOW)).toEqual({ current: 0, best: 9, lastDate: "2026-09-18" });
    expect(effectiveStreak({ current: 3, best: 5, lastDate: "2026-10-24" }, NOW).current).toBe(0);
  });
  it("handles empty records", () => {
    expect(effectiveStreak({ current: 0, best: 0, lastDate: "" }, NOW).current).toBe(0);
  });
  it("is just after midnight UTC: yesterday's claim still counts", () => {
    const justAfter = Date.parse("2026-10-26T00:00:30Z");
    expect(effectiveStreak({ current: 2, best: 2, lastDate: "2026-10-25" }, justAfter).current).toBe(2);
  });
});
