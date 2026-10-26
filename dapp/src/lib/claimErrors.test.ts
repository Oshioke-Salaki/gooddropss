import { describe, it, expect } from "vitest";
import { friendlyClaimError, friendlyUbiError, extractErrorText } from "@/lib/claimErrors";

describe("friendlyClaimError — the real reported errors", () => {
  it("maps 'insufficient funds for gas' to the gas message (not raw)", () => {
    const r = friendlyClaimError(new Error(
      'The contract function "claimWithProof" reverted: Magic RPC Error: [-32603] Error forwarded from node, error_forwarding_sequencer: insufficient funds for gas * price + value: have 111007762500000000 want 120778577500000000, undefined',
    ));
    expect(r.kind).toBe("gas");
    expect(r.terminal).toBe(false);
    expect(r.message).not.toMatch(/0x|have 111|gas \* price/);
    expect(r.message.toLowerCase()).toContain("celo");
  });

  it("maps 'Magic RPC Error [-32603] Load failed' to a network hiccup", () => {
    const r = friendlyClaimError(new Error(
      'The contract function "claimWithProof" reverted with the following reason: Magic RPC Error: [-32603] Load failed',
    ));
    expect(r.kind).toBe("network");
    expect(r.terminal).toBe(false);
    expect(r.message.toLowerCase()).toContain("try again");
  });

  it("detects a genuine already-claimed revert as terminal", () => {
    const r = friendlyClaimError({ shortMessage: "execution reverted: AlreadyClaimed()" });
    expect(r.kind).toBe("claimed");
    expect(r.terminal).toBe(true);
  });

  it("treats a user-rejected prompt as silent (no message)", () => {
    const r = friendlyClaimError({ shortMessage: "User rejected the request." });
    expect(r.kind).toBe("rejected");
    expect(r.message).toBe("");
  });

  it("expired drop is terminal", () => {
    expect(friendlyClaimError(new Error("execution reverted: DropExpired()")).terminal).toBe(true);
  });

  it("never leaks a raw string on an unknown error", () => {
    const r = friendlyClaimError(new Error("0xdeadbeef weird internal boom"));
    expect(r.kind).toBe("unknown");
    expect(r.message).not.toContain("0xdeadbeef");
  });
});

describe("friendlyUbiError — the faucet threshold error", () => {
  it("maps 'Failed to meet balance threshold after faucet request' to a faucet message", () => {
    const msg = friendlyUbiError(new Error("Failed to meet balance threshold after faucet request."));
    expect(msg.toLowerCase()).toContain("faucet");
    expect(msg).not.toMatch(/threshold after faucet request/i);
  });
  it("stays silent on user rejection", () => {
    expect(friendlyUbiError({ message: "User rejected the request." })).toBe("");
  });
});

describe("extractErrorText", () => {
  it("digs shortMessage, message and nested cause", () => {
    const t = extractErrorText({ shortMessage: "top", cause: { message: "deep insufficient funds" } });
    expect(t).toContain("top");
    expect(t).toContain("deep insufficient funds");
  });
  it("handles strings and null", () => {
    expect(extractErrorText("plain")).toBe("plain");
    expect(extractErrorText(null)).toBe("");
  });
});

describe("friendlyClaimError — hex in verbose errors", () => {
  // viem's full message embeds the sender, args and calldata in hex. Digits like
  // 503 inside an address must not read as an HTTP 503 and hide the real reason.
  const verbose = (name: string) => ({
    shortMessage: `The contract function "claimWithProof" reverted.`,
    message: `The contract function "claimWithProof" reverted.\n\nError: ${name}()\n\nContract Call:\n  address: 0x261565422e8ec1340f84d3adadbf4ad5fc7d5131\n  function: claimWithProof(uint256 dropId, uint256 deadline, bytes sig)\n  sender: 0x5034a502bd5049f504aa00000000000000032603`,
  });

  it("still sees NotWhitelisted when the sender address contains 502/503/504", () => {
    expect(friendlyClaimError(verbose("NotWhitelisted")).kind).toBe("verify");
  });
  it("isn't fooled by the word 'deadline' in the function signature", () => {
    expect(friendlyClaimError(verbose("SelfClaim")).kind).toBe("self");
    expect(friendlyClaimError(verbose("ProofExpired")).kind).toBe("network");
  });
  it("still sees AlreadyClaimed and DropExpired through hex noise", () => {
    expect(friendlyClaimError(verbose("AlreadyClaimed")).kind).toBe("claimed");
    expect(friendlyClaimError(verbose("DropExpired")).kind).toBe("expired");
  });
  it("still treats a real 503 / -32603 as a network problem", () => {
    expect(friendlyClaimError(new Error("HTTP request failed. Status: 503")).kind).toBe("network");
    expect(friendlyClaimError(new Error("Magic RPC Error: [-32603] Load failed")).kind).toBe("network");
  });
});

