import { describe, it, expect } from "vitest";
import { buildIcs } from "./ics";
import { relativeLine, toLocalInput, fromLocalInput, distanceLabel, shortG, wholeG } from "./format";

describe("event display helpers", () => {
  it("counts down and up", () => {
    expect(relativeLine("upcoming", 1000 + 3 * 3600 + 20 * 60, 99999, 1000)).toBe("Starts in 3h 20m");
    expect(relativeLine("ended", 0, 1000, 1000 + 2 * 86_400)).toBe("Ended 2 days ago");
  });
  it("round-trips datetime-local values", () => {
    const t = 1_800_000_000 - (1_800_000_000 % 60);
    expect(fromLocalInput(toLocalInput(t))).toBe(t);
    expect(Number.isNaN(fromLocalInput(""))).toBe(true);
  });
  it("formats distance and money", () => {
    expect(distanceLabel(240)).toBe("240 m away");
    expect(distanceLabel(3400)).toBe("3.4 km away");
    expect(shortG(15_500)).toBe("16k");
    expect(wholeG((1234n * 10n ** 18n).toString())).toBe("1,234");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs({
    id: "abc123", title: "Campus Hunt, Finals; 2026", description: "Line one\nLine two", venueName: "Main gate",
    lat: 6.5, lng: 3.4, startsAt: 1_800_000_000, endsAt: 1_800_003_600, url: "https://www.gooddrops.xyz/events/abc123",
  });
  it("uses UTC times and escapes text", () => {
    expect(ics).toContain("DTSTART:20270115T080000Z");
    expect(ics).toContain("DTEND:20270115T090000Z");
    expect(ics).toContain("SUMMARY:Campus Hunt\\, Finals\; 2026");
    expect(ics).toContain("Line one\\nLine two");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
  });
});
