import { describe, it, expect, vi } from "vitest";

// A plain switchable stub (not vi.fn): what the identity read returns or throws.
let next: { state?: string; fail?: boolean } = {};
vi.mock("@/lib/identity", () => ({
  readIdentityStatus: async () => {
    if (next.fail) throw new Error("rpc down");
    return { state: next.state };
  },
}));
vi.mock("@/lib/publicClient", () => ({ publicClient: {} }));

import { dropBlockedReason } from "./dropGate";

const A = "0x1111111111111111111111111111111111111111";

describe("dropBlockedReason (verify before dropping, fail closed)", () => {
  it("lets a verified wallet drop", async () => {
    next = { state: "verified" };
    expect(await dropBlockedReason(A)).toBeNull();
  });

  it("blocks never-verified, lapsed and blocked wallets with the right words", async () => {
    next = { state: "none" };
    expect(await dropBlockedReason(A)).toMatch(/^Verify your GoodDollar identity/);
    next = { state: "lapsed" };
    expect(await dropBlockedReason(A)).toMatch(/^Re-verify/);
    next = { state: "blacklisted" };
    expect(await dropBlockedReason(A)).toMatch(/blocked/);
  });

  it("never lets a drop through when the check itself fails", async () => {
    next = { fail: true };
    expect(await dropBlockedReason(A)).toMatch(/couldn't confirm/);
  });
});
