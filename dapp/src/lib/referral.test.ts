import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import {
  referralAcceptMessage, inviteUrl, withRef, recruiterTier,
  parseCapturedRef, nextCapturedRef, REF_CAPTURE_TTL_MS,
  inviteOutcome, parseInviterInput, confirmsSilently, isFinalInvite, shortAddress,
} from "@/lib/referral";

describe("inviteUrl / withRef", () => {
  it("builds a clean invite link", () => {
    expect(inviteUrl("https://gooddrops.xyz", "0xABC0000000000000000000000000000000000001"))
      .toBe("https://gooddrops.xyz/?ref=0xabc0000000000000000000000000000000000001");
  });
  it("trims a trailing slash on the base", () => {
    expect(inviteUrl("https://gooddrops.xyz/", "0x00000000000000000000000000000000000000aa"))
      .toBe("https://gooddrops.xyz/?ref=0x00000000000000000000000000000000000000aa");
  });
  it("withRef appends, preserving an existing query string", () => {
    expect(withRef("https://x.io/drop/5", "0x00000000000000000000000000000000000000Aa"))
      .toBe("https://x.io/drop/5?ref=0x00000000000000000000000000000000000000aa");
    expect(withRef("https://x.io/drop/5?a=1", "0x00000000000000000000000000000000000000aa"))
      .toBe("https://x.io/drop/5?a=1&ref=0x00000000000000000000000000000000000000aa");
  });
  it("withRef is a no-op for a missing/invalid address", () => {
    expect(withRef("https://x.io", null)).toBe("https://x.io");
    expect(withRef("https://x.io", "not-an-address")).toBe("https://x.io");
  });
});

describe("recruiterTier", () => {
  it("tiers up by count", () => {
    expect(recruiterTier(0).label).toBe("Newcomer");
    expect(recruiterTier(1).label).toBe("Recruiter");
    expect(recruiterTier(5).label).toBe("Connector");
    expect(recruiterTier(10).label).toBe("Ringleader");
    expect(recruiterTier(25).label).toBe("Kingpin");
  });
});

describe("referral accept signature round-trip", () => {
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );

  it("server recovers the invitee (signer) from the accept message", async () => {
    const referrer = "0x00000000000000000000000000000000000000ff";
    const timestamp = 1_700_000_000_000;
    const message = referralAcceptMessage(referrer, timestamp);
    const signature = await account.signMessage({ message });
    const recovered = await recoverMessageAddress({ message, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("a different referrer in the rebuilt message breaks recovery (no cross-attribution)", async () => {
    const timestamp = 1_700_000_000_000;
    const signed = await account.signMessage({
      message: referralAcceptMessage("0x00000000000000000000000000000000000000ff", timestamp),
    });
    const recovered = await recoverMessageAddress({
      message: referralAcceptMessage("0x00000000000000000000000000000000000000ee", timestamp),
      signature: signed,
    });
    expect(recovered.toLowerCase()).not.toBe(account.address.toLowerCase());
  });
});

describe("withRef replaces rather than duplicates", () => {
  const A = "0x00000000000000000000000000000000000000aa", B = "0x00000000000000000000000000000000000000bb";
  it("swaps an existing ref for the sharer's own", () => {
    expect(withRef(`https://x.io/drop/5?ref=${A}`, B)).toBe(`https://x.io/drop/5?ref=${B}`);
    expect(withRef(`https://x.io/?a=1&ref=${A}&b=2`, B)).toBe(`https://x.io/?a=1&b=2&ref=${B}`);
  });
  it("keeps a #fragment at the end", () => {
    expect(withRef("https://x.io/drop/5#map", A)).toBe(`https://x.io/drop/5?ref=${A}#map`);
  });
});

describe("captured invite (on the device)", () => {
  const A = "0x00000000000000000000000000000000000000aa", B = "0x00000000000000000000000000000000000000bb";
  const now = 1_800_000_000_000;
  it("reads the new format and the old bare-address format", () => {
    expect(parseCapturedRef(JSON.stringify({ ref: A.toUpperCase().replace("0X", "0x"), at: now - 1000 }), now)).toEqual({ ref: A, at: now - 1000 });
    expect(parseCapturedRef(A, now)).toEqual({ ref: A, at: now });
  });
  it("drops junk, expired and future-dated entries", () => {
    expect(parseCapturedRef(null, now)).toBeNull();
    expect(parseCapturedRef("{bad", now)).toBeNull();
    expect(parseCapturedRef(JSON.stringify({ ref: "nope", at: now }), now)).toBeNull();
    expect(parseCapturedRef(JSON.stringify({ ref: A, at: now - REF_CAPTURE_TTL_MS - 1 }), now)).toBeNull();
    expect(parseCapturedRef(JSON.stringify({ ref: A, at: now + 3_600_000 }), now)).toBeNull();
  });
  it("first touch wins until it expires", () => {
    const first = JSON.stringify({ ref: A, at: now - 1000 });
    expect(nextCapturedRef(first, B, now)?.ref).toBe(A);
    expect(nextCapturedRef(null, B, now)).toEqual({ ref: B, at: now });
    const stale = JSON.stringify({ ref: A, at: now - REF_CAPTURE_TTL_MS - 1 });
    expect(nextCapturedRef(stale, B, now)?.ref).toBe(B);
    expect(nextCapturedRef(first, "garbage", now)?.ref).toBe(A);
  });
});

describe("who invited you (typed input)", () => {
  const A = "0x00000000000000000000000000000000000000aa";
  it("accepts a username, @username, an address, or a pasted invite link", () => {
    expect(parseInviterInput("  ada_1 ")).toEqual({ kind: "username", username: "ada_1" });
    expect(parseInviterInput("@ada")).toEqual({ kind: "username", username: "ada" });
    expect(parseInviterInput(A.toUpperCase().replace("0X", "0x"))).toEqual({ kind: "address", address: A });
    expect(parseInviterInput(`https://gooddrops.xyz/?ref=${A}`)).toEqual({ kind: "address", address: A });
    expect(parseInviterInput(`gooddrops.xyz/drop/9?x=1&ref=${A}`)).toEqual({ kind: "address", address: A });
  });
  it("rejects what it can't use", () => {
    for (const v of ["", "  ", "ab", "has space", "https://gooddrops.xyz/", `?ref=${A}ff`]) expect(parseInviterInput(v)).toBeNull();
  });
});

describe("invite outcome copy", () => {
  it("has a plain sentence for every outcome, without jargon", () => {
    const cases = [
      { status: "credited" }, { status: "already" },
      { status: "waiting", reason: "verify" }, { status: "waiting", reason: "task" }, { status: "waiting", reason: "retry" },
      { status: "rejected", reason: "self" }, { status: "rejected", reason: "notNew" },
      { status: "rejected", reason: "taken" }, { status: "rejected", reason: "expired" },
    ] as const;
    for (const c of cases) {
      const o = inviteOutcome(c, "@ada");
      expect(o.text.length).toBeGreaterThan(10);
      expect(o.text).not.toMatch(/signature|transaction|blockchain|on-chain|wallet address|root/i);
    }
    expect(inviteOutcome({ status: "credited" }, "@ada").tone).toBe("ok");
    expect(inviteOutcome({ status: "rejected", reason: "taken" }, "@ada").tone).toBe("error");
  });
  it("knows which outcomes are final", () => {
    expect(isFinalInvite("credited")).toBe(true);
    expect(isFinalInvite("rejected")).toBe(true);
    expect(isFinalInvite("waiting")).toBe(false);
    expect(isFinalInvite("none")).toBe(false);
  });
});

describe("wallets and names", () => {
  it("only Magic wallets confirm silently", () => {
    expect(confirmsSilently("magic")).toBe(true);
    expect(confirmsSilently("magic-partner")).toBe(true);
    for (const id of ["injected", "walletConnect", "metaMask", undefined, null, ""]) expect(confirmsSilently(id)).toBe(false);
  });
  it("shortens addresses", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});
