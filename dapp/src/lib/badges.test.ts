import { describe, it, expect } from "vitest";
import {
  BUILTIN_BADGES, evaluateBadges, ruleSatisfied, isValidRule, isBuiltinBadgeId,
  type BadgeInputs,
} from "@/lib/badges";
import type { Drop } from "@/types";

const G = 10n ** 18n;

function mkDrop(over: Partial<Drop> = {}): Drop {
  return {
    id: 1n, dropper: "0xd", amount: 10n * G, claimer: "0xc",
    expiry: 0, claimedAt: 0, createdAt: 0, status: 1,
    lat: 10_483_500, lng: 7_417_500, // Barnawa, degrees × 1e6
    hint: "",
    ...over,
  } as Drop;
}

const empty: BadgeInputs = { claimed: [], created: [], bestStreak: 0 };

describe("builtin badge rules", () => {
  it("a fresh account earns nothing", () => {
    expect(evaluateBadges(BUILTIN_BADGES, empty)).toEqual([]);
  });

  it("one claim earns exactly First Hunt", () => {
    const got = evaluateBadges(BUILTIN_BADGES, { ...empty, claimed: [mkDrop()] });
    expect(got).toEqual(["first-hunt"]);
  });

  it("legacy thresholds are mirrored (collector 5, pioneer 10, whale 200)", () => {
    const s: BadgeInputs = {
      claimed: Array.from({ length: 5 }, (_, i) => mkDrop({ id: BigInt(i) })),
      created: Array.from({ length: 10 }, (_, i) => mkDrop({ id: BigInt(100 + i), amount: 200n * G })),
      bestStreak: 0,
    };
    const got = new Set(evaluateBadges(BUILTIN_BADGES, s));
    expect(got.has("collector")).toBe(true);
    expect(got.has("pioneer")).toBe(true);
    expect(got.has("whale")).toBe(true);       // 200 G$ single drop
    expect(got.has("drop-maker")).toBe(true);
    expect(got.has("serial-hunter")).toBe(false); // only 5 claims
  });

  it("Speed Demon uses createdAt→claimedAt, within 5 minutes", () => {
    const fast = mkDrop({ createdAt: 1000, claimedAt: 1250 });
    const slow = mkDrop({ createdAt: 1000, claimedAt: 5000 });
    expect(evaluateBadges(BUILTIN_BADGES, { ...empty, claimed: [fast] })).toContain("speed-demon");
    expect(evaluateBadges(BUILTIN_BADGES, { ...empty, claimed: [slow] })).not.toContain("speed-demon");
  });

  it("On Fire needs a 7-day streak", () => {
    expect(evaluateBadges(BUILTIN_BADGES, { ...empty, claimed: [mkDrop()], bestStreak: 7 })).toContain("on-fire");
    expect(evaluateBadges(BUILTIN_BADGES, { ...empty, bestStreak: 6 })).not.toContain("on-fire");
  });
});

describe("event/venue rules", () => {
  it("claimed_drop_in matches by drop id", () => {
    const s = { ...empty, claimed: [mkDrop({ id: 42n })] };
    expect(ruleSatisfied({ type: "claimed_drop_in", dropIds: ["42", "43"] }, s)).toBe(true);
    expect(ruleSatisfied({ type: "claimed_drop_in", dropIds: ["99"] }, s)).toBe(false);
  });

  it("claimed_near uses the DROP's on-chain coords and ignores private (0,0) drops", () => {
    const near = { type: "claimed_near", lat: 10.4835, lng: 7.4175, radiusM: 300 } as const;
    expect(ruleSatisfied(near, { ...empty, claimed: [mkDrop()] })).toBe(true);
    // ~11km away
    expect(ruleSatisfied(near, { ...empty, claimed: [mkDrop({ lat: 10_583_500 })] })).toBe(false);
    // private drop hides coords as (0,0) — must never match a venue
    expect(ruleSatisfied(near, { ...empty, claimed: [mkDrop({ lat: 0, lng: 0 })] })).toBe(false);
  });

  it("campaign_claims counts claims carrying the campaign hint tag", () => {
    const s = { ...empty, claimed: [mkDrop({ hint: "[C:summer]find me" }), mkDrop({ id: 2n, hint: "[C:summer]again" })] };
    expect(ruleSatisfied({ type: "campaign_claims", campaignId: "summer", n: 2 }, s)).toBe(true);
    expect(ruleSatisfied({ type: "campaign_claims", campaignId: "summer", n: 3 }, s)).toBe(false);
  });

  it("unknown rule types never award (forward-compat safety)", () => {
    expect(ruleSatisfied({ type: "brand_new_rule" } as never, { ...empty, claimed: [mkDrop()] })).toBe(false);
  });
});

describe("rule validation (admin input)", () => {
  it("accepts well-formed rules", () => {
    expect(isValidRule({ type: "claims_at_least", n: 5 })).toBe(true);
    expect(isValidRule({ type: "claimed_near", lat: 6.5, lng: 3.4, radiusM: 300 })).toBe(true);
    expect(isValidRule({ type: "claimed_drop_in", dropIds: ["1", "2"] })).toBe(true);
  });
  it("rejects malformed ones", () => {
    expect(isValidRule({ type: "claims_at_least", n: 0 })).toBe(false);
    expect(isValidRule({ type: "claimed_near", lat: 95, lng: 3.4, radiusM: 300 })).toBe(false);
    expect(isValidRule({ type: "claimed_drop_in", dropIds: ["not-a-number"] })).toBe(false);
    expect(isValidRule({ type: "nope" })).toBe(false);
    expect(isValidRule(null)).toBe(false);
  });
  it("builtin ids are protected", () => {
    expect(isBuiltinBadgeId("whale")).toBe(true);
    expect(isBuiltinBadgeId("devconnect-1")).toBe(false);
  });
});
