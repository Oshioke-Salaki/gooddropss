import { describe, it, expect } from "vitest";
import {
  validateDraft, eventPhase, eventClaimGate, computeEventStats, buildEventHint, eventIdOf,
  draftDigest, eventMessage, publicEvent, statsToJson, statsFromJson, LIMITS, type GdEvent, type EventDraft,
} from "./events";
import { DROP_STATUS, type Drop } from "@/types";

const NOW = 1_800_000_000;
const ORG = "0x00000000000000000000000000000000000000aa";
const CO = "0x00000000000000000000000000000000000000bb";
const STRANGER = "0x00000000000000000000000000000000000000cc";
const H1 = "0x0000000000000000000000000000000000000011";
const H2 = "0x0000000000000000000000000000000000000022";
const ZERO = "0x0000000000000000000000000000000000000000";
const G = 10n ** 18n;

const good = {
  title: "  Campus   Hunt ", description: "Bring friends.\nFree.", category: "campus", venueName: "Main gate",
  lat: 6.5, lng: 3.4, startsAt: NOW + 3600, endsAt: NOW + 3 * 3600, budgetG: 500, link: "", cohosts: [],
};

function ev(over: Partial<GdEvent> = {}): GdEvent {
  return {
    ...(validateDraft(good, NOW) as { ok: true; value: EventDraft }).value,
    id: "abc123xyz", organizer: ORG, status: "approved", createdAt: NOW, updatedAt: NOW, cohosts: [CO], ...over,
  };
}

let nid = 1n;
const drop = (p: Partial<Drop>): Drop => ({
  id: nid++, dropper: ORG, amount: 10n * G, claimer: ZERO, expiry: NOW + 86_400, claimedAt: 0, createdAt: NOW,
  status: DROP_STATUS.Active, lat: 0, lng: 0, hint: buildEventHint("clue", "abc123xyz"), ...p,
});

describe("validateDraft", () => {
  it("accepts a good draft and normalises it", () => {
    const r = validateDraft(good, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("Campus Hunt");
      expect(r.value.description).toBe("Bring friends.\nFree.");
    }
  });
  const bad: [string, Record<string, unknown>, RegExp][] = [
    ["short title", { title: "ab" }, /name/],
    ["bad category", { category: "rave" }, /category/],
    ["no venue pin", { lat: 0, lng: 0 }, /Pin the venue/],
    ["ends before start", { endsAt: NOW + 1800, startsAt: NOW + 3600 }, /end after/],
    ["too short", { endsAt: NOW + 3600 + 600 }, /30 minutes/],
    ["too long", { endsAt: NOW + 3600 + 8 * 86_400 }, /7 days/],
    ["in the past", { startsAt: NOW - 7200, endsAt: NOW + 3600 }, /past/],
    ["too far ahead", { startsAt: NOW + 200 * 86_400, endsAt: NOW + 200 * 86_400 + 3600 }, /6 months/],
    ["tiny budget", { budgetG: 1 }, /budget/],
    ["huge budget", { budgetG: 1e9 }, /too large/],
    ["bad link", { link: "not a link" }, /link/],
    ["bad cohost", { cohosts: ["0x123"] }, /co-host/],
  ];
  for (const [name, patch, re] of bad) {
    it(`rejects: ${name}`, () => {
      const r = validateDraft({ ...good, ...patch }, NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    });
  }
  it("adds https to bare links and dedupes co-hosts, dropping the organizer", () => {
    const r = validateDraft({ ...good, link: "lu.ma/abc", cohosts: [CO, CO.toUpperCase().replace("0X", "0x"), ORG] }, NOW, { organizer: ORG });
    expect(r.ok && r.value.link).toBe("https://lu.ma/abc");
    expect(r.ok && r.value.cohosts).toEqual([CO]);
  });
  it("lets a live event be edited when allowed", () => {
    expect(validateDraft({ ...good, startsAt: NOW - 3600 }, NOW, { allowStarted: true }).ok).toBe(true);
  });
  it(`caps co-hosts at ${LIMITS.maxCohosts}`, () => {
    const many = Array.from({ length: 6 }, (_, i) => `0x${String(i + 1).padStart(40, "0")}`);
    expect(validateDraft({ ...good, cohosts: many }, NOW).ok).toBe(false);
  });
});

describe("lifecycle", () => {
  it("phases by time", () => {
    const e = ev();
    expect(eventPhase(e, NOW)).toBe("upcoming");
    expect(eventPhase(e, e.startsAt)).toBe("live");
    expect(eventPhase(e, e.endsAt)).toBe("ended");
  });

  it("locks host drops until an approved event starts", () => {
    const e = ev();
    expect(eventClaimGate(e, ORG, NOW).locked).toBe(true);
    expect(eventClaimGate(e, CO, NOW).locked).toBe(true);
    expect(eventClaimGate(e, ORG, e.startsAt).locked).toBe(false);
  });
  it("never locks someone else's drop, or a pending/rejected/unknown event", () => {
    expect(eventClaimGate(ev(), STRANGER, NOW).locked).toBe(false);
    expect(eventClaimGate(ev({ status: "pending" }), ORG, NOW).locked).toBe(false);
    expect(eventClaimGate(ev({ status: "rejected" }), ORG, NOW).locked).toBe(false);
    expect(eventClaimGate(null, ORG, NOW).locked).toBe(false);
  });
  it("keeps drops locked when cancelled before the start, but not after", () => {
    expect(eventClaimGate(ev({ status: "cancelled", cancelledAt: NOW }), ORG, NOW + 10 * 86_400).locked).toBe(true);
    const e = ev();
    expect(eventClaimGate({ ...e, status: "cancelled", cancelledAt: e.startsAt + 60 }, ORG, e.startsAt + 120).locked).toBe(false);
  });
});

describe("tags & signing", () => {
  it("finds the event tag, even under a riddle wrapper", () => {
    expect(eventIdOf(buildEventHint("x", "abc123xyz"))).toBe("abc123xyz");
    expect(eventIdOf(`[R]${buildEventHint("x", "abc123xyz")}`)).toBe("abc123xyz");
    expect(eventIdOf("[C:abc123xyz]x")).toBeNull();
  });
  it("digest changes with content and is key-order independent", () => {
    const a = ev();
    const { id: _i, organizer: _o, status: _s, createdAt: _c, updatedAt: _u, ...draft } = a;
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as unknown as EventDraft;
    expect(draftDigest(draft)).toBe(draftDigest(reordered));
    expect(draftDigest({ ...draft, budgetG: 501 })).not.toBe(draftDigest(draft));
    expect(eventMessage("create", "new", 1, "0xab")).toContain("Action: create");
  });
  it("hides review notes from the public but not from hosts", () => {
    const e = ev({ rejectReason: "x", pendingEdit: null });
    expect("rejectReason" in publicEvent(e, STRANGER)).toBe(false);
    expect(publicEvent(e, CO).rejectReason).toBe("x");
  });
});

describe("computeEventStats", () => {
  it("counts only host drops tagged for this event", () => {
    const drops = [
      drop({ amount: 50n * G }),                                                                  // live, organizer
      drop({ dropper: CO, status: DROP_STATUS.Claimed, claimer: H1, claimedAt: NOW + 10, amount: 20n * G }),
      drop({ status: DROP_STATUS.Claimed, claimer: H1, claimedAt: NOW + 20, amount: 30n * G }),
      drop({ status: DROP_STATUS.Claimed, claimer: H2, claimedAt: NOW + 5, amount: 5n * G }),
      drop({ status: DROP_STATUS.Active, expiry: NOW - 1 }),                                       // expired, not live
      drop({ dropper: STRANGER, amount: 999n * G }),                                              // not a host
      drop({ hint: buildEventHint("x", "otherevent1") }),                                         // other event
    ];
    const s = computeEventStats(ev(), drops, NOW);
    expect(s.drops).toBe(5);
    expect(s.droppedWei).toBe(115n * G);
    expect(s.claims).toBe(3);
    expect(s.claimedWei).toBe(55n * G);
    expect(s.live).toBe(1);
    expect(s.liveWei).toBe(50n * G);
    expect(s.hunters).toBe(2);
    expect(s.firstClaimAt).toBe(NOW + 5);
    expect(s.lastClaimAt).toBe(NOW + 20);
    expect(s.recent.map((r) => r.claimedAt)).toEqual([NOW + 20, NOW + 10, NOW + 5]);
    expect(s.topHunters[0]).toEqual({ address: H1, claims: 2, wei: 50n * G });
  });
  it("counts one person once across their wallets", () => {
    const drops = [
      drop({ status: DROP_STATUS.Claimed, claimer: H1, claimedAt: NOW + 1 }),
      drop({ status: DROP_STATUS.Claimed, claimer: H2, claimedAt: NOW + 2 }),
    ];
    const s = computeEventStats(ev(), drops, NOW, () => "same-person");
    expect(s.hunters).toBe(1);
    expect(s.topHunters[0].address).toBe(H2); // their most recent wallet
  });
  it("round-trips through JSON", () => {
    const s = computeEventStats(ev(), [drop({ status: DROP_STATUS.Claimed, claimer: H1, claimedAt: NOW })], NOW);
    expect(statsFromJson(JSON.parse(JSON.stringify(statsToJson(s))))).toEqual(s);
  });
});

import { parseDropHint } from "@/lib/utils";
describe("parseDropHint understands event tags", () => {
  it("reads the event id and the clue, with or without a riddle", () => {
    expect(parseDropHint("[E:abc123xyz]by the stage")).toMatchObject({ eventId: "abc123xyz", hint: "by the stage", hasRiddle: false });
    expect(parseDropHint("[R][E:abc123xyz]by the stage")).toMatchObject({ eventId: "abc123xyz", hint: "by the stage", hasRiddle: true });
  });
  it("leaves other drops alone", () => {
    expect(parseDropHint("plain clue").eventId).toBeNull();
    expect(parseDropHint("[C:camp1]x")).toMatchObject({ eventId: null, campaignId: "camp1" });
    expect(parseDropHint("[P:][E:abc123xyz]x").eventId).toBeNull(); // never on private drops
  });
});
