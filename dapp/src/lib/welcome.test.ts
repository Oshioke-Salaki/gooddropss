import { describe, expect, it } from "vitest";
import {
  WELCOME_DEFAULTS, welcomeConfig, pickTier, pickSpot, decideWelcome, watDay, distanceM, hash32,
  CREATING_STALE_S, SPOT_MIN_M, SPOT_MAX_M, type WelcomeRecord, type SpotCandidate,
} from "@/lib/welcome";
import { buildWelcomeHint, isWelcomeHint, parseDropHint } from "@/lib/utils";

const NOW = 1_800_000_000;
const ROOT = "0x" + "a".repeat(40);
const cfg = WELCOME_DEFAULTS;
const rec = (o: Partial<WelcomeRecord>): WelcomeRecord => ({ root: ROOT, wallet: ROOT, status: "live", tries: 1, createdAt: NOW - 60, ...o });

// A point d metres north of `o`.
const north = (o: { lat: number; lng: number }, d: number) => ({ lat: o.lat + d / 111_320, lng: o.lng });
const ME = { lat: 7.723, lng: 4.4268 };

describe("welcome config", () => {
  it("falls back to defaults for anything malformed", () => {
    expect(welcomeConfig(null)).toEqual(WELCOME_DEFAULTS);
    const c = welcomeConfig({ enabled: false, dailyCap: -1, budgetG: 5_000, tiers: [{ g: 10, per1000: 10 }] } as never);
    expect(c.enabled).toBe(false);
    expect(c.dailyCap).toBe(WELCOME_DEFAULTS.dailyCap);
    expect(c.budgetG).toBe(5_000);
    expect(c.tiers).toEqual(WELCOME_DEFAULTS.tiers); // tiers must add up to 1,000
  });
  it("accepts tiers that add up to 1,000", () => {
    const tiers = [{ g: 100, per1000: 1000 }];
    expect(welcomeConfig({ tiers }).tiers).toEqual(tiers);
  });
  it("default tiers add up to 1,000", () => {
    expect(WELCOME_DEFAULTS.tiers.reduce((s, t) => s + t.per1000, 0)).toBe(1000);
  });
});

describe("chest size", () => {
  it("is deterministic per person and attempt", () => {
    expect(pickTier(cfg, ROOT, 1)).toBe(pickTier(cfg, ROOT.toUpperCase().replace("0X", "0x"), 1));
    expect(cfg.tiers.map((t) => t.g)).toContain(pickTier(cfg, ROOT, 1));
  });
  it("roughly follows the odds", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 20_000; i++) {
      const g = pickTier(cfg, `0x${i.toString(16).padStart(40, "0")}`, 1);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    for (const t of cfg.tiers) expect(Math.abs((counts.get(t.g) ?? 0) / 20_000 - t.per1000 / 1000)).toBeLessThan(0.02);
  });
});

describe("chest spot", () => {
  it("goes right where you are when there's no known place nearby", () => {
    const s = pickSpot(ME, [{ ...north(ME, 2_000), kind: "landmark" }], "x");
    expect(s).toEqual({ lat: ME.lat, lng: ME.lng, kind: "here", distanceM: 0 });
  });
  it("never picks a place too close or too far", () => {
    const cands: SpotCandidate[] = [
      { ...north(ME, SPOT_MIN_M - 20), kind: "landmark" },
      { ...north(ME, SPOT_MAX_M + 30), kind: "landmark" },
      { ...north(ME, 300), kind: "claim" },
    ];
    for (let i = 0; i < 20; i++) {
      const s = pickSpot(ME, cands, `seed${i}`);
      expect(s.kind).toBe("claim");
      expect(s.distanceM).toBeGreaterThanOrEqual(SPOT_MIN_M);
      expect(s.distanceM).toBeLessThanOrEqual(SPOT_MAX_M);
    }
  });
  it("prefers a landmark over a past claim spot at a similar walk", () => {
    const s = pickSpot(ME, [{ ...north(ME, 260), kind: "claim" }, { ...north(ME, 280), kind: "landmark", name: "Mokola Roundabout" }], "s");
    expect(s.kind).toBe("landmark");
    expect(s.name).toBe("Mokola Roundabout");
  });
  it("ignores null island and bad numbers, and dedupes one corner", () => {
    const corner = north(ME, 250);
    const s = pickSpot(ME, [
      { lat: 0, lng: 0, kind: "landmark" }, { lat: NaN, lng: 1, kind: "claim" },
      { ...corner, kind: "claim" }, { lat: corner.lat + 0.00001, lng: corner.lng, kind: "claim" },
    ], "d");
    expect(s.kind).toBe("claim");
    expect(Math.abs(distanceM(ME.lat, ME.lng, s.lat, s.lng) - 250)).toBeLessThan(5);
  });
  it("spreads players at the same spot across nearby places", () => {
    const cands: SpotCandidate[] = [200, 230, 260, 290, 320].map((d) => ({ ...north(ME, d), kind: "landmark" as const }));
    const picked = new Set<number>();
    for (let i = 0; i < 40; i++) picked.add(pickSpot(ME, cands, `p${i}`).distanceM);
    expect(picked.size).toBeGreaterThan(2);
  });
});

describe("what a player sees", () => {
  const ready = { cfg, now: NOW, rec: null, active: false, verified: true, today: 0, issuedG: 0 };

  it("asks for only what it needs, cheapest first", () => {
    expect(decideWelcome({ cfg, now: NOW, rec: null })).toBe("need-active");
    expect(decideWelcome({ cfg, now: NOW, rec: null, active: false })).toBe("need-verified");
    expect(decideWelcome({ cfg, now: NOW, rec: null, active: false, verified: true })).toBe("need-counts");
  });
  it("offers a chest to a new verified player", () => {
    expect(decideWelcome(ready)).toEqual({ state: "ready", attempt: 1 });
  });
  it("never offers one to someone who already played", () => {
    expect(decideWelcome({ ...ready, active: true })).toEqual({ state: "done" });
  });
  it("asks the unverified to verify", () => {
    expect(decideWelcome({ ...ready, verified: false })).toEqual({ state: "verify" });
  });
  it("respects the off switch, the daily cap and the budget", () => {
    expect(decideWelcome({ ...ready, cfg: { ...cfg, enabled: false } })).toEqual({ state: "off" });
    expect(decideWelcome({ ...ready, today: cfg.dailyCap })).toEqual({ state: "full" });
    expect(decideWelcome({ ...ready, issuedG: cfg.budgetG - 100 })).toEqual({ state: "full" });
  });
  it("shows a live chest without any further checks", () => {
    const v = decideWelcome({ cfg, now: NOW, rec: rec({ dropId: "7", lat: 1, lng: 2, kind: "claim", expiry: NOW + 100 }) });
    expect(v).toMatchObject({ state: "live", dropId: "7", lat: 1, lng: 2 });
  });
  it("a live chest still shows when the switch is off (it's already funded)", () => {
    const v = decideWelcome({ cfg: { ...cfg, enabled: false }, now: NOW, rec: rec({ dropId: "7", lat: 1, lng: 2, expiry: NOW + 100 }) });
    expect(v).toMatchObject({ state: "live" });
  });
  it("shows the opened chest, and its amount, once claimed", () => {
    expect(decideWelcome({ cfg, now: NOW, rec: rec({ status: "claimed", amountG: 400, dropId: "7" }) }))
      .toEqual({ state: "claimed", amountG: 400, dropId: "7" });
  });
  it("re-hides a chest that ran out, only while tries remain", () => {
    const ran = rec({ status: "live", dropId: "7", lat: 1, lng: 2, expiry: NOW - 1 });
    expect(decideWelcome({ ...ready, rec: ran })).toEqual({ state: "ready", attempt: 2 });
    expect(decideWelcome({ ...ready, rec: { ...ran, tries: cfg.maxTries } })).toEqual({ state: "done" });
  });
  it("a chest of ours doesn't count as 'already played'", () => {
    const ran = rec({ status: "expired", tries: 1 });
    expect(decideWelcome({ ...ready, rec: ran, active: true })).toEqual({ state: "ready", attempt: 2 });
  });
  it("a request in flight blocks a second one, until it's stale", () => {
    const c = rec({ status: "creating", tries: 1, createdAt: NOW - 10 });
    expect(decideWelcome({ ...ready, rec: c })).toEqual({ state: "creating" });
    expect(decideWelcome({ ...ready, rec: { ...c, createdAt: NOW - CREATING_STALE_S - 1 } })).toEqual({ state: "ready", attempt: 1 });
  });
});

describe("helpers", () => {
  it("days run on Lagos time", () => {
    expect(watDay(Date.parse("2026-11-25T23:30:00Z") / 1000)).toBe("2026-11-26");
    expect(watDay(Date.parse("2026-11-25T22:30:00Z") / 1000)).toBe("2026-11-25");
  });
  it("hash is stable", () => {
    expect(hash32("abc")).toBe(hash32("abc"));
    expect(hash32("abc")).not.toBe(hash32("abd"));
  });
  it("the chest's clue is private, recognisable, and reads cleanly", () => {
    const h = buildWelcomeHint("Your welcome chest");
    expect(isWelcomeHint(h)).toBe(true);
    expect(isWelcomeHint("[P:]Your welcome chest")).toBe(false);
    expect(isWelcomeHint("Your welcome chest")).toBe(false);
    const p = parseDropHint(h);
    expect(p.isPrivate).toBe(true);
    expect(p.hint).toBe("Your welcome chest");
  });
});
