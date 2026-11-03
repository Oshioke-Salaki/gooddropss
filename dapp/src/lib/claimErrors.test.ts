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
    expect(r.message).not.toMatch(/celo|gas|faucet|fee/i); // plain words, no jargon
    expect(r.message.toLowerCase()).toContain("try again");
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
    expect(msg).not.toMatch(/celo|gas|faucet/i);
    expect(msg.toLowerCase()).toContain("try again");
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

describe("friendlyClaimError — event drops", () => {
  it("passes the event lock message through, naming the event", () => {
    const fe = friendlyClaimError(new Error("This drop unlocks when Campus Hunt starts."));
    expect(fe).toEqual({ message: "This drop unlocks when Campus Hunt starts.", terminal: true, kind: "event" });
  });
  it("explains a cancelled event", () => {
    expect(friendlyClaimError(new Error("Campus Hunt was cancelled, so its drops stay locked.")).kind).toBe("event");
  });
});


describe("friendlyClaimError — the server's own claim sentences", () => {
  it("tells a hunter their riddle answer was wrong, and lets them retry", () => {
    const fe = friendlyClaimError(new Error("Not quite — that's not the answer."));
    expect(fe.kind).toBe("answer");
    expect(fe.terminal).toBe(false);
    expect(fe.message).toMatch(/not the answer/i);
  });
  it("too many wrong answers asks them to wait", () => {
    const fe = friendlyClaimError(new Error("Too many wrong answers — wait a minute and try again."));
    expect(fe.kind).toBe("answer");
    expect(fe.message).toMatch(/wait a minute/i);
  });
  it("a task drop explains the shop scan", () => {
    expect(friendlyClaimError(new Error("Do the task, then have the merchant scan your QR to unlock this drop.")).kind).toBe("task");
  });
  it("our own outage never reads as 'get closer'", () => {
    const fe = friendlyClaimError(new Error("GPS signing not configured"));
    expect(fe.kind).toBe("network");
    expect(fe.message).not.toMatch(/closer/i);
  });
  it("too far still reads as distance", () => {
    expect(friendlyClaimError(new Error("Too far from drop")).kind).toBe("location");
  });
  it("the unknown fallback fits any action, not only claims", () => {
    expect(friendlyClaimError(new Error("weird")).message).not.toMatch(/claim/i);
  });
});
