import { describe, it, expect } from "vitest";
import { circulatedG, REWARDS_G, REWARDS_WEI } from "./circulation";

describe("G$ circulated", () => {
  it("is every G$ dropped plus rewards paid", () => {
    expect(circulatedG(1_636_560)).toBe(1_636_560 + REWARDS_G);
    expect(circulatedG(0)).toBe(REWARDS_G);
  });
  it("keeps the wei and whole-G$ rewards in step", () => {
    expect(REWARDS_WEI).toBe(BigInt(REWARDS_G) * 10n ** 18n);
  });
});
