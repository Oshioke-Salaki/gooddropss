import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { isReportReason, reportMessage, DROP_ID_RE, reasonLabel } from "@/lib/reports";

describe("report reason validation", () => {
  it("accepts every known reason", () => {
    for (const r of ["not_there", "scam", "offensive", "spam", "other"])
      expect(isReportReason(r)).toBe(true);
  });
  it("rejects unknown / malformed reasons", () => {
    for (const r of ["", "NOT_THERE", "hack", 5, null, undefined, {}])
      expect(isReportReason(r)).toBe(false);
  });
  it("has a human label for each reason", () => {
    expect(reasonLabel("scam")).toMatch(/scam/i);
    expect(reasonLabel("bogus")).toBe("Other");
  });
});

describe("DROP_ID_RE", () => {
  it("accepts numeric drop ids", () => {
    expect(DROP_ID_RE.test("0")).toBe(true);
    expect(DROP_ID_RE.test("42")).toBe(true);
  });
  it("rejects non-numeric / injection-y ids", () => {
    for (const bad of ["", "1a", "0x1", "1 2", "-1", "1.0", "٤٢"])
      expect(DROP_ID_RE.test(bad)).toBe(false);
  });
});

describe("report signature auth round-trip", () => {
  // The client signs reportMessage(...); the server rebuilds the SAME string and
  // recovers the signer. This proves the two stay in lockstep — the crux of the
  // report auth path.
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );

  it("recovers the exact signer from a signed report message", async () => {
    const dropId = "123";
    const reason = "scam";
    const timestamp = 1_700_000_000_000;
    const message = reportMessage(dropId, reason, timestamp);
    const signature = await account.signMessage({ message });
    const recovered = await recoverMessageAddress({ message, signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("a tampered field breaks recovery (can't be replayed for another drop)", async () => {
    const timestamp = 1_700_000_000_000;
    const signed = await account.signMessage({ message: reportMessage("123", "scam", timestamp) });
    // Server rebuilds with a DIFFERENT dropId → recovers a different address.
    const recovered = await recoverMessageAddress({
      message: reportMessage("999", "scam", timestamp),
      signature: signed,
    });
    expect(recovered.toLowerCase()).not.toBe(account.address.toLowerCase());
  });
});
