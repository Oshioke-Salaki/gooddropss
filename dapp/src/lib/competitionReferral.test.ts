import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RefCompConfig } from "@/lib/competition";

// ── Fake Redis ────────────────────────────────────────────────────────────────
// computeReferralBoard only needs SMEMBERS plus a pipeline of ZRANGE BYSCORE
// WITHSCORES, so the double stays tiny and the real `keys` helper is kept.
interface Fixture {
  participants: string[];
  /** referrer root → [inviteeRoot, creditedAt][] */
  credited: Record<string, [string, number][]>;
  /** "referrer|invitee" pairs already settled by a transfer */
  paidSlots?: string[];
}

let fixture: Fixture;

vi.mock("@/lib/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis")>();
  return {
    ...actual,
    getRedis: () => ({
      smembers: async (key: string) =>
        key.startsWith("gd:comp:ref:slots:") ? (fixture.paidSlots ?? []) : fixture.participants,
      pipeline: () => {
        const roots: string[] = [];
        const api = {
          zrange: (key: string) => {
            roots.push(key.replace("gd:ref:credited:", ""));
            return api;
          },
          exec: async () =>
            roots.map((root) =>
              (fixture.credited[root] ?? []).flatMap(([invitee, at]) => [invitee, at]),
            ),
        };
        return api;
      },
    }),
  };
});

const { computeReferralBoard } = await import("@/lib/competitionReferral");

const G = (n: number) => (BigInt(n) * 10n ** 18n).toString();

/** 3 slots (pot 3 G$ ÷ 1 G$ each), unlock at 2 referrals. */
const cfg: RefCompConfig = {
  id: "test-season",
  startsAt: 0,
  endsAt: 10_000,
  potWei: G(3),
  perReferralWei: G(1),
  threshold: 2,
};

const earnedOf = (board: Awaited<ReturnType<typeof computeReferralBoard>>, root: string) =>
  board.entries.find((e) => e.root === root)?.earnedWei ?? "0";

beforeEach(() => {
  fixture = { participants: [], credited: {}, paidSlots: [] };
});

describe("computeReferralBoard", () => {
  it("pays nothing below the unlock threshold", async () => {
    fixture = {
      participants: ["alice"],
      credited: { alice: [["i1", 100]] }, // 1 < threshold 2
      paidSlots: [],
    };
    const board = await computeReferralBoard(cfg);
    expect(earnedOf(board, "alice")).toBe("0");
    expect(board.entries[0].unlocked).toBe(false);
    // A locked referrer must not consume the pot.
    expect(board.stats.slotsUsed).toBe(0);
  });

  it("covers referrals first-come-first-served and never exceeds the pot", async () => {
    fixture = {
      participants: ["alice", "carol"],
      credited: {
        alice: [["i1", 100], ["i2", 101]],
        carol: [["i3", 200], ["i4", 201]],
      },
      paidSlots: [],
    };
    const board = await computeReferralBoard(cfg);
    // 4 eligible referrals, only 3 slots — the three oldest win.
    expect(board.stats.slotsUsed).toBe(3);
    expect(earnedOf(board, "alice")).toBe(G(2)); // t=100,101
    expect(earnedOf(board, "carol")).toBe(G(1)); // t=200 only
    expect(BigInt(board.stats.paidOutWei)).toBeLessThanOrEqual(BigInt(cfg.potWei));
  });

  it("keeps a PAID slot even when an older referral unlocks later", async () => {
    // The regression this rule exists for. Bob sat below the threshold with a
    // referral older than everyone's; the day he unlocks, that old timestamp
    // would jump the FCFS queue and displace Carol — who has already been paid.
    fixture = {
      participants: ["alice", "carol", "bob"],
      credited: {
        alice: [["i1", 100], ["i2", 101]],
        carol: [["i3", 200], ["i4", 201]],
        bob: [["i0", 10], ["i5", 300]], // i0 is the oldest credit on the board
      },
      // Alice and Carol were paid earlier, locking all three slots.
      paidSlots: ["alice|i1", "alice|i2", "carol|i3"],
    };
    const board = await computeReferralBoard(cfg);

    expect(earnedOf(board, "alice")).toBe(G(2));
    expect(earnedOf(board, "carol")).toBe(G(1)); // NOT displaced by bob's t=10
    expect(earnedOf(board, "bob")).toBe("0");    // unlocked, but the pot is spent
    expect(board.stats.slotsUsed).toBe(3);
    expect(BigInt(board.stats.paidOutWei)).toBeLessThanOrEqual(BigInt(cfg.potWei));
  });

  it("without paid slots, the same board WOULD displace carol (guards the fixture)", async () => {
    // Same data, nothing paid yet — proves the previous test is actually
    // exercising the lock rather than passing for an unrelated reason.
    fixture = {
      participants: ["alice", "carol", "bob"],
      credited: {
        alice: [["i1", 100], ["i2", 101]],
        carol: [["i3", 200], ["i4", 201]],
        bob: [["i0", 10], ["i5", 300]],
      },
      paidSlots: [],
    };
    const board = await computeReferralBoard(cfg);
    expect(earnedOf(board, "bob")).toBe(G(1));   // t=10 takes the first slot
    expect(earnedOf(board, "carol")).toBe("0");  // displaced
  });

  it("is deterministic across runs", async () => {
    fixture = {
      participants: ["alice", "carol"],
      credited: { alice: [["i1", 100], ["i2", 100]], carol: [["i3", 100], ["i4", 100]] },
      paidSlots: [],
    };
    const a = await computeReferralBoard(cfg);
    const b = await computeReferralBoard(cfg);
    expect(a.entries.map((e) => [e.root, e.earnedWei])).toEqual(
      b.entries.map((e) => [e.root, e.earnedWei]),
    );
  });
});

describe("podium seasons", () => {
  const podiumCfg: RefCompConfig = { ...cfg, podium: [50, 30, 20], sponsor: "GoodCash" };

  it("ranks by referral count, not earnings, once the pot is spent", async () => {
    // A unlocks early and takes all 3 paid slots; B refers more people later.
    fixture = {
      participants: ["a", "b"],
      credited: { a: [["a1", 1], ["a2", 2], ["a3", 3]], b: [["b1", 10], ["b2", 11], ["b3", 12], ["b4", 13]] },
    };
    const plain = await computeReferralBoard(cfg);
    expect(plain.entries[0].root).toBe("a"); // unchanged: earnings first without a podium
    const board = await computeReferralBoard(podiumCfg);
    expect(board.entries.map((e) => e.root)).toEqual(["b", "a"]);
    expect(earnedOf(board, "b")).toBe("0"); // pot already gone, the podium is what's left
  });

  it("on a tie, whoever got there first ranks higher", async () => {
    fixture = {
      participants: ["late", "early"],
      credited: { late: [["l1", 5], ["l2", 50]], early: [["e1", 4], ["e2", 20]] },
    };
    const board = await computeReferralBoard(podiumCfg);
    expect(board.entries.map((e) => e.root)).toEqual(["early", "late"]);
  });
});
