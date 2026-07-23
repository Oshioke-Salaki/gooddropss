import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import {
  addLandmarkClue, cleanLandmarkName, landmarkCreateMessage,
  isLandmarkCategory, LANDMARK_CLUE_RADIUS_M,
} from "@/lib/landmarks";

describe("addLandmarkClue", () => {
  it("prefixes an empty hint with the place", () => {
    expect(addLandmarkClue("", "Colab Campus", 200)).toBe("Near Colab Campus");
  });
  it("prepends the place to an existing hint", () => {
    expect(addLandmarkClue("under the bench", "Colab", 200)).toBe("Near Colab — under the bench");
  });
  it("is idempotent — won't add a place already named (any case)", () => {
    const once = addLandmarkClue("under the bench", "Colab", 200);
    expect(addLandmarkClue(once, "colab", 200)).toBe(once);
  });
  it("never exceeds maxLen", () => {
    const out = addLandmarkClue("x".repeat(50), "A very long landmark name here", 40);
    expect(out.length).toBeLessThanOrEqual(40);
  });
  it("ignores a blank place name", () => {
    expect(addLandmarkClue("keep me", "   ", 200)).toBe("keep me");
  });
  it("clue radius is a sane positive distance", () => {
    expect(LANDMARK_CLUE_RADIUS_M).toBeGreaterThan(0);
  });
});

describe("cleanLandmarkName", () => {
  it("collapses whitespace and trims", () => {
    expect(cleanLandmarkName("  Big   Market  ")).toBe("Big Market");
  });
  it("strips control characters", () => {
    // Build the control byte in code so no raw control char lands in source.
    const withNull = "Ab" + String.fromCharCode(0) + "cd";
    expect(cleanLandmarkName(withNull)).toBe("Abcd");
  });
});

describe("isLandmarkCategory", () => {
  it("accepts known categories and rejects others", () => {
    expect(isLandmarkCategory("market")).toBe(true);
    expect(isLandmarkCategory("nonsense")).toBe(false);
    expect(isLandmarkCategory(42)).toBe(false);
  });
});

describe("landmark signature auth round-trip", () => {
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );

  it("client-signed create message recovers to the signer (matches server)", async () => {
    const p = { id: "abc-123", name: "Colab", category: "campus", lat: 6.5244, lng: 3.3792, timestamp: 1_700_000_000_000 };
    const message = landmarkCreateMessage(p);
    const signature = await account.signMessage({ message });
    const recovered = await recoverMessageAddress({ message, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("coordinates are pinned to 6dp so client & server messages match byte-for-byte", () => {
    const a = landmarkCreateMessage({ id: "i", name: "n", category: "market", lat: 6.5244000001, lng: 3.3792, timestamp: 1 });
    const b = landmarkCreateMessage({ id: "i", name: "n", category: "market", lat: 6.5244, lng: 3.3792, timestamp: 1 });
    expect(a).toBe(b);
  });
});
