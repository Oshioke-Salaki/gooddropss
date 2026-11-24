import { describe, it, expect } from "vitest";
import { AUTO_REWARDS_FLOOR_G, circulatedG, REWARDS_BASE_G, REWARDS_BASE_WEI, sumAutoRewardsG } from "./circulation";

const G = 10n ** 18n;

describe("G$ circulated", () => {
  it("is every G$ dropped plus rewards paid by hand plus rewards paid by the app", () => {
    expect(circulatedG(1_636_560, 500_000)).toBe(1_636_560 + REWARDS_BASE_G + 500_000);
  });
  it("keeps the wei and whole-G$ base in step", () => {
    expect(REWARDS_BASE_WEI).toBe(BigInt(REWARDS_BASE_G) * G);
  });
  it("rises with every referral payout and first-drop bonus", () => {
    const before = sumAutoRewardsG({ "referrals-2026-11-16": (500_000n * G).toString() }, 0);
    const after = sumAutoRewardsG({ "referrals-2026-11-16": (504_800n * G).toString() }, 200);
    expect(after - before).toBe(4_800 + 200);
  });
  it("adds up every competition, but never the one already counted by hand", () => {
    const g = sumAutoRewardsG({
      "referrals-2026-09-10": (406_687n * G).toString(),
      "referrals-2026-11-16": (430_000n * G).toString(),
      "referrals-2027-01-01": (10_000n * G).toString(),
    }, 0);
    expect(g).toBe(440_000);
  });
  it("never shows less than was already paid, and shrugs off junk", () => {
    expect(sumAutoRewardsG({}, 0)).toBe(AUTO_REWARDS_FLOOR_G);
    expect(sumAutoRewardsG({ x: "nope", y: null }, Number.NaN)).toBe(AUTO_REWARDS_FLOOR_G);
  });
  it("is no lower than the old fixed figure on the day it went live", () => {
    expect(REWARDS_BASE_G + AUTO_REWARDS_FLOOR_G).toBeGreaterThanOrEqual(4_068_200);
  });
});
