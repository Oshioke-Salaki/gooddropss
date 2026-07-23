import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { referralAcceptMessage, inviteUrl, withRef, recruiterTier } from "@/lib/referral";

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
