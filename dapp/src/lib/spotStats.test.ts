import { describe, expect, it } from "vitest";
import { buildSpotStats, type RewardDrop } from "./spotStats";
import type { Spot, SpotPayment } from "@/types";

const NOW = 1_800_000_000;
const G = (n: number) => BigInt(n) * 10n ** 18n;
const spot = (id: string, extra: Partial<Spot> = {}): Spot => ({
  id, name: id, description: "", category: "food", discount: "", wallet: "0x" + "1".repeat(40), ownerAddress: "0x" + "2".repeat(40),
  lat: 8.5, lng: 8.5, createdAt: NOW - 100 * 86_400, ...extra,
});
const pay = (payer: string, g: number, ts = NOW - 86_400): SpotPayment => ({ payer, amount: G(g).toString(), tx: payer + g + ts, ts, verified: true });
const drop = (id: string, g: number, status: number, claimer: string | null = null, expiry = NOW + 3600): RewardDrop =>
  ({ dropId: id, amountWei: G(g).toString(), claimer, status, claimedAt: status === 1 ? NOW - 10 : 0, createdAt: NOW - 1000, expiry });

function run(over: Partial<Parameters<typeof buildSpotStats>[0]> = {}) {
  return buildSpotStats({
    spots: [spot("a"), spot("b", { status: "pending" })],
    statusOf: (s) => s.status ?? "active",
    payStats: new Map([["a", { count: 3, wei: G(300) }]]),
    paymentLists: new Map([["a", [pay("0xp1", 100), pay("0xp1", 100, NOW - 40 * 86_400), pay("0xP2", 100)]]]),
    rewardIds: new Map([["a", ["1", "2", "3"]], ["b", ["4"]]]),
    rewardDrops: new Map([["1", drop("1", 50, 1, "0xc1")], ["2", drop("2", 50, 0)], ["3", drop("3", 50, 0, null, NOW - 1)], ["4", drop("4", 20, 1, "0xp1")]]),
    approvals: [{ ts: NOW, root: "0xR1", spotId: "a" }, { ts: NOW, root: "0xc1", spotId: "a" }],
    approvalLogFull: false,
    nowSec: NOW,
    ...over,
  });
}

describe("buildSpotStats", () => {
  it("adds up what each business took in and who came", () => {
    const s = run();
    const a = s.rows.find((r) => r.id === "a")!;
    expect(a.payments).toBe(3);
    expect(a.paidWei).toBe(G(300).toString());
    expect(a.payers).toBe(2);                        // 0xp1 twice, 0xP2 once (case-folded)
    expect(a.payments30d).toBe(2);
    expect(a.paidWei30d).toBe(G(200).toString());
    expect(a.rewards).toBe(3);
    expect(a.rewardsClaimed).toBe(1);
    expect(a.rewardsLive).toBe(1);
    expect(a.rewardsExpired).toBe(1);
    expect(a.circulatedWei).toBe(G(350).toString()); // paid in + rewards claimed
    expect(a.visitors).toBe(4);                      // p1, p2, c1 (also approved), r1
  });

  it("totals across businesses without double counting people", () => {
    const s = run();
    expect(s.businesses).toBe(2);
    expect(s.byStatus).toMatchObject({ active: 1, pending: 1 });
    expect(s.customers).toBe(2);
    expect(s.visitors).toBe(4);                      // 0xp1 claimed at b too: still one person
    expect(s.circulatedWei).toBe(G(370).toString());
    expect(s.rewardsClaimed).toBe(2);
    expect(s.approvals).toBe(2);
    expect(s.activeWithPayments).toBe(1);
    expect(s.rows[0].id).toBe("a");                  // most G$ circulated first
  });

  it("flags when the stored payment list is shorter than the all-time count", () => {
    expect(run({ payStats: new Map([["a", { count: 900, wei: G(1) }]]) }).paymentListCapped).toBe(true);
    expect(run().paymentListCapped).toBe(false);
  });

  it("copes with a shop that has nothing yet", () => {
    const s = run({ spots: [spot("z")], payStats: new Map(), paymentLists: new Map(), rewardIds: new Map(), approvals: [] });
    expect(s.rows[0]).toMatchObject({ payments: 0, visitors: 0, circulatedWei: "0", lastPaymentAt: null });
  });
});
