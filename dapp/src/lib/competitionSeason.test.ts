import { describe, expect, it } from "vitest";
import { COMP_DEFAULT, REF_COMP_DEFAULT, coveredReferralSlots, compPhase, refCompPhase } from "./competition";

const G = 10n ** 18n;

describe("season defaults", () => {
  it("points prizes add up to exactly the pot", () => {
    const sum = COMP_DEFAULT.tiers.reduce((s, g) => s + BigInt(g), 0n);
    expect(sum * G).toBe(BigInt(COMP_DEFAULT.potWei));
  });

  it("referral pot covers whole referrals and never more than it holds", () => {
    const slots = coveredReferralSlots(REF_COMP_DEFAULT);
    expect(BigInt(slots) * BigInt(REF_COMP_DEFAULT.perReferralWei)).toBeLessThanOrEqual(BigInt(REF_COMP_DEFAULT.potWei));
    expect(BigInt(slots + 1) * BigInt(REF_COMP_DEFAULT.perReferralWei)).toBeGreaterThan(BigInt(REF_COMP_DEFAULT.potWei));
  });

  it("both competitions share one window and the phases follow it", () => {
    expect(REF_COMP_DEFAULT.startsAt).toBe(COMP_DEFAULT.startsAt);
    expect(REF_COMP_DEFAULT.endsAt).toBe(COMP_DEFAULT.endsAt);
    const { startsAt, endsAt } = COMP_DEFAULT;
    expect(compPhase(COMP_DEFAULT, startsAt - 1)).toBe("upcoming");
    expect(compPhase(COMP_DEFAULT, startsAt)).toBe("live");
    expect(compPhase(COMP_DEFAULT, endsAt)).toBe("ended");
    expect(refCompPhase(REF_COMP_DEFAULT, startsAt, 0)).toBe("live");
    expect(refCompPhase(REF_COMP_DEFAULT, startsAt, coveredReferralSlots(REF_COMP_DEFAULT))).toBe("ended");
  });

  it("season ids are unique per window, so a new season starts clean", () => {
    expect(COMP_DEFAULT.id).not.toBe(REF_COMP_DEFAULT.id);
  });
});
