import { describe, it, expect } from "vitest";
import { normalizeSpotDraft, pickSpotPatch, spotDigest, spotMessage } from "./spotAuth";

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
