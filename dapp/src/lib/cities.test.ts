import { describe, expect, it } from "vitest";
import { cityAt, cityBoard, cityOfDrop } from "@/lib/cities";
import type { Drop } from "@/types";

const G = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
const at = (lat: number, lng: number) => ({ lat: Math.round(lat * 1e6), lng: Math.round(lng * 1e6) });
const d = (id: number, over: Partial<Drop>): Drop => ({
  id: BigInt(id), dropper: "0x00000000000000000000000000000000000000aa", amount: 10n * G, claimer: ZERO,
  expiry: 0, claimedAt: 0, createdAt: 0, status: 0, ...at(10.52, 7.44), hint: "", ...over,
});
const week = { start: 1_000, end: 2_000 };

describe("cityAt", () => {
  it("places points in the nearest city within its radius", () => {
    expect(cityAt(10.61, 7.44)?.id).toBe("kaduna");     // AFIT campus
    expect(cityAt(8.47, 8.59)?.id).toBe("lafia");
    expect(cityAt(17.4, 78.5)?.id).toBe("hyderabad");
    expect(cityAt(9.07, 7.49)?.id).toBe("abuja");
  });
  it("leaves the open sea, deserts and private drops out", () => {
    expect(cityAt(-1.9, -26.0)).toBeNull();
    expect(cityAt(20, 0)).toBeNull();
    expect(cityOfDrop({ lat: 0, lng: 0 })).toBeNull();
  });
});

describe("cityBoard", () => {
  it("counts this week's finds, hunters (by identity) and hidden drops, ranked by G$ found", () => {
    const rootOf = (w: string) => (w === "0x2" ? "0x1" : w); // 0x1 and 0x2 are one person
    const drops = [
      d(1, { status: 1, claimer: "0x1", claimedAt: 1_500, amount: 10n * G }),
      d(2, { status: 1, claimer: "0x2", claimedAt: 1_600, amount: 30n * G }),
      d(3, { status: 1, claimer: "0x3", claimedAt: 1_700, amount: 100n * G, ...at(8.49, 8.52) }), // Lafia
      d(4, { status: 1, claimer: "0x4", claimedAt: 2_000, amount: 999n * G }),                  // next week
      d(5, { createdAt: 1_200 }),                                                                 // hidden this week
      d(6, { status: 1, claimer: "0x5", claimedAt: 1_500, ...at(-1.9, -26) }),                  // nowhere
    ];
    const rows = cityBoard(drops, rootOf, week);
    expect(rows.map((r) => r.id)).toEqual(["lafia", "kaduna"]);
    expect(rows[1]).toMatchObject({ name: "Kaduna", foundWei: 40n * G, claims: 2, hunters: 1, hidden: 1 });
    expect(rows[0]).toMatchObject({ foundWei: 100n * G, claims: 1, hunters: 1, hidden: 0 });
  });
  it("is empty when nothing happened this week", () => {
    expect(cityBoard([d(1, { status: 1, claimer: "0x1", claimedAt: 5 })], (w) => w, week)).toEqual([]);
  });
});

describe("resetsIn", () => {
  it("counts down to Monday in plain words", async () => {
    const { resetsIn } = await import("@/lib/cities");
    expect(resetsIn(10 * 86_400, 0)).toBe("Resets in 10 days");
    expect(resetsIn(86_400 + 60, 0)).toBe("Resets tomorrow");
    expect(resetsIn(3 * 3_600, 0)).toBe("Resets in 3 hours");
    expect(resetsIn(60, 0)).toBe("Resets in 1 hour");
    expect(resetsIn(0, 100)).toBe("Resets in 1 hour");
  });
});
