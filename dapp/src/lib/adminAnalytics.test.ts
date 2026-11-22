import { describe, expect, it } from "vitest";
import { analyticsFromJson, analyticsToJson, computeAdminAnalytics } from "@/lib/adminAnalytics";
import { REWARDS_WEI } from "@/lib/circulation";
import type { Drop } from "@/types";

const ZERO = "0x0000000000000000000000000000000000000000";
const W1 = "0x00000000000000000000000000000000000000a1";
const W2 = "0x00000000000000000000000000000000000000a2"; // same person as W1
const W3 = "0x00000000000000000000000000000000000000a3";
const NOW = Date.parse("2026-11-22T12:00:00Z");
const s = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const G = 10n ** 18n;

const d = (id: number, over: Partial<Drop>): Drop => ({
  id: BigInt(id), dropper: W1, amount: 100n * G, claimer: ZERO, expiry: s("2026-12-01T00:00:00Z"), claimedAt: 0,
  createdAt: s("2026-11-22T08:00:00Z"), status: 0, lat: 0, lng: 0, hint: "", ...over,
});

describe("computeAdminAnalytics", () => {
  const roots = new Map([[W1, W1], [W2, W1], [W3, W3]]);
  const drops = [
    d(1, {}),                                                                                        // active
    d(2, { expiry: s("2026-11-01T00:00:00Z") }),                                                     // expired, unclaimed
    d(3, { status: 1, claimer: W3, createdAt: s("2026-11-22T09:00:00Z"), claimedAt: s("2026-11-22T10:00:00Z") }), // found today, 1 h
    d(4, { dropper: W2, status: 1, claimer: W3, createdAt: s("2026-11-20T00:00:00Z"), claimedAt: s("2026-11-20T03:00:00Z") }), // 3 h
    d(5, { status: 2, amount: 50n * G }),                                                            // reclaimed
  ];
  const a = computeAdminAnalytics(drops, roots, NOW);

  it("counts drops by state", () => {
    expect(a).toMatchObject({ total: 5, active: 2, claimed: 2, reclaimed: 1, expiredUnclaimed: 1 });
    expect(a.claimRate).toBe(67); // 2 of 3 settled
  });

  it("sums G$ by state, and circulation is all drops plus rewards", () => {
    expect(a.claimedWei).toBe(200n * G);
    expect(a.reclaimedWei).toBe(50n * G);
    expect(a.activeWei).toBe(200n * G);
    expect(a.circulatedWei).toBe(450n * G + REWARDS_WEI);
  });

  it("counts people by identity, not wallet", () => {
    expect(a.droppers).toBe(1);  // W1 and W2 are one person
    expect(a.hunters).toBe(1);
    expect(a.humans).toBe(2);
    expect(a.activeToday).toBe(1);
  });

  it("builds 14 UTC days, oldest first, and the average time to find", () => {
    expect(a.days).toHaveLength(14);
    expect(a.days[13]).toEqual({ day: "2026-11-22", n: 4 });
    expect(a.days[11]).toEqual({ day: "2026-11-20", n: 1 });
    expect(a.claimedDays[13]).toEqual({ day: "2026-11-22", wei: 100n * G });
    expect(a.maxDay).toBe(4);
    expect(a.maxClaimedWei).toBe(100n * G);
    expect(a.avgTtcSec).toBe(2 * 3600);
  });

  it("survives an empty history", () => {
    const e = computeAdminAnalytics([], new Map(), NOW);
    expect(e).toMatchObject({ total: 0, claimRate: 0, avgTtcSec: 0, maxDay: 1, maxClaimedWei: 1n, circulatedWei: REWARDS_WEI });
  });

  it("round-trips through JSON exactly", () => {
    const back = analyticsFromJson(JSON.parse(JSON.stringify(analyticsToJson(a))));
    expect(back).toEqual(a);
  });
});
