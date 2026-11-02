import { describe, it, expect } from "vitest";
import { normalizeContact, normalizeSpotDraft, pickSpotPatch, spotDigest, spotMessage } from "./spotAuth";
import { CODE_RE, formatCode } from "./taskShared";

const base = {
  name: "  Mama T's Kitchen ", description: "Rice and stew", category: "food", discount: "",
  wallet: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", lat: 10.5, lng: 7.4, placeName: null,
};

describe("spot signing", () => {
  it("normalizes the way the server stores it", () => {
    const d = normalizeSpotDraft(base);
    expect(d.name).toBe("Mama T's Kitchen");
    expect(d.wallet).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
    expect(d.placeName).toBe("");
    expect(d.category).toBe("food");
  });

  it("gives the same digest for the same content, whitespace and case aside", () => {
    const a = spotDigest(normalizeSpotDraft(base));
    const b = spotDigest(normalizeSpotDraft({ ...base, name: "Mama T's Kitchen", wallet: base.wallet.toLowerCase(), placeName: "" }));
    expect(a).toBe(b);
  });

  it("changes the digest when any signed detail changes", () => {
    const a = spotDigest(normalizeSpotDraft(base));
    expect(spotDigest(normalizeSpotDraft({ ...base, wallet: "0x" + "1".repeat(40) }))).not.toBe(a);
    expect(spotDigest(normalizeSpotDraft({ ...base, lat: 10.6 }))).not.toBe(a);
    expect(spotDigest(normalizeSpotDraft({ ...base, name: "Other" }))).not.toBe(a);
  });

  it("signs only the fields an edit sends, in any key order", () => {
    const p1 = pickSpotPatch({ wallet: " 0xABC ", name: "Shop", signature: "0x1", timestamp: 1 });
    expect(p1).toEqual({ name: "Shop", wallet: "0xabc" });
    expect(spotDigest(p1)).toBe(spotDigest(pickSpotPatch({ name: "Shop ", wallet: "0xabc" })));
    expect(spotDigest(p1)).not.toBe(spotDigest(pickSpotPatch({ name: "Shop", wallet: "0xabd" })));
  });

  it("binds action, shop, content and time into the message", () => {
    const m = spotMessage("pause", "abc-123", 1700000000000, spotDigest(null));
    expect(m).toContain("Action: pause");
    expect(m).toContain("Shop: abc-123");
    expect(m).toContain("Content: none");
    expect(m).toContain("Time: 1700000000000");
    expect(spotMessage("reactivate", "abc-123", 1700000000000, "none")).not.toBe(m);
  });
});

describe("owner contact", () => {
  it("keeps a phone number in one canonical form", () => {
    expect(normalizeContact("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizeContact("0803-123-4567")).toBe("08031234567");
    expect(normalizeContact("+254 (712) 345 678")).toBe("+254712345678");
  });
  it("rejects things that aren't phone numbers", () => {
    expect(normalizeContact("call me")).toBe("");
    expect(normalizeContact("123")).toBe("");
    expect(normalizeContact("1".repeat(16))).toBe("");
    expect(normalizeContact(undefined)).toBe("");
  });
  it("doesn't change the signature for sign-ups without a number", () => {
    const base = { name: "Shop", description: "", category: "food", discount: "", wallet: "0x" + "a".repeat(40), lat: 1, lng: 2, placeName: "" };
    expect(spotDigest(normalizeSpotDraft(base))).toBe(spotDigest(normalizeSpotDraft({ ...base, contact: "" })));
    expect(spotDigest(normalizeSpotDraft(base))).not.toBe(spotDigest(normalizeSpotDraft({ ...base, contact: "+2348031234567" })));
  });
});

describe("reward codes", () => {
  it("formats six digits for reading aloud", () => {
    expect(formatCode("481205")).toBe("481 205");
    expect(CODE_RE.test("481205")).toBe(true);
    expect(CODE_RE.test("48120")).toBe(false);
    expect(CODE_RE.test("48120a")).toBe(false);
  });
});
