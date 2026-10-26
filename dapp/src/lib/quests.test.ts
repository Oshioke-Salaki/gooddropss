import { describe, it, expect } from "vitest";
import { weekBounds, questIdsForWeek, evaluateQuests, liveStreakDays } from "@/lib/quests";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("weekBounds (Lagos time, Monday start)", () => {
  it("starts on Monday 00:00 WAT, which is Sunday 23:00 UTC", () => {
    const w = weekBounds(at("2026-10-28T12:00:00Z")); // a Wednesday
    expect(new Date(w.start * 1000).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(w.end - w.start).toBe(7 * 86_400);
  });

  it("treats Sunday 23:30 UTC as already Monday in Lagos", () => {
    const w = weekBounds(at("2026-11-01T23:30:00Z"));
    expect(new Date(w.start * 1000).toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });

  it("treats Sunday 22:59 UTC as still the previous week", () => {
    const w = weekBounds(at("2026-11-01T22:59:00Z"));
    expect(new Date(w.start * 1000).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("gives consecutive weeks consecutive indexes", () => {
    const a = weekBounds(at("2026-10-28T12:00:00Z"));
    const b = weekBounds(at("2026-11-04T12:00:00Z"));
    expect(b.index - a.index).toBe(1);
    expect(b.start).toBe(a.end);
  });

  it("is stable across the whole week", () => {
    const mon = weekBounds(at("2026-10-25T23:00:00Z"));
    const sun = weekBounds(at("2026-11-01T22:59:59Z"));
    expect(sun.start).toBe(mon.start);
  });
});

describe("quest rotation", () => {
  it("always includes claiming and two others, no duplicates", () => {
    for (let i = 0; i < 12; i++) {
      const ids = questIdsForWeek(i);
      expect(ids).toHaveLength(3);
      expect(ids[0]).toBe("claim");
      expect(new Set(ids).size).toBe(3);
    }
  });

  it("varies week to week", () => {
    expect(questIdsForWeek(0)).not.toEqual(questIdsForWeek(1));
  });

  it("handles negative indexes without crashing", () => {
    expect(questIdsForWeek(-1)).toHaveLength(3);
  });
});

describe("evaluateQuests", () => {
  const none = { claims: 0, dropsHidden: 0, referrals: 0, streak: 0 };

  it("caps progress at the target and marks done", () => {
    const q = evaluateQuests(0, { ...none, claims: 5, dropsHidden: 1 });
    const claim = q.find((x) => x.id === "claim")!;
    expect(claim.progress).toBe(2);
    expect(claim.done).toBe(true);
    expect(q.find((x) => x.id === "hide")!.done).toBe(true);
  });

  it("reports partial progress", () => {
    const claim = evaluateQuests(0, { ...none, claims: 1 }).find((x) => x.id === "claim")!;
    expect(claim).toMatchObject({ progress: 1, target: 2, done: false });
  });

  it("never goes negative or fractional", () => {
    const q = evaluateQuests(1, { claims: -3, dropsHidden: 0.9, referrals: NaN, streak: 2.7 });
    for (const x of q) {
      expect(Number.isInteger(x.progress)).toBe(true);
      expect(x.progress).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("liveStreakDays", () => {
  const now = at("2026-10-28T12:00:00Z");
  const week = weekBounds(now);

  it("counts a streak whose last claim was today or yesterday", () => {
    expect(liveStreakDays({ current: 4, lastDate: "2026-10-28" }, now, week)).toBe(4);
    expect(liveStreakDays({ current: 4, lastDate: "2026-10-27" }, now, week)).toBe(4);
  });

  it("ignores a broken streak", () => {
    expect(liveStreakDays({ current: 9, lastDate: "2026-10-25" }, now, week)).toBe(0);
  });

  it("ignores missing or empty streaks", () => {
    expect(liveStreakDays(null, now, week)).toBe(0);
    expect(liveStreakDays({ current: 0, lastDate: "" }, now, week)).toBe(0);
  });
});
