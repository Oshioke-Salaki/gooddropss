import { describe, it, expect } from "vitest";
import { encodeFunctionData, parseAbi, maxUint256, type Hex } from "viem";
import { classify, decide, innerCalls, isCelo } from "@/lib/sponsorPolicy";
import { ERC20_ABI, GOOD_DROPS_ABI, GOOD_DROPS_ADDRESS, G_TOKEN_ADDRESS } from "@/lib/contracts";
import { FLOW_COUNCIL, FLOW_COUNCIL_ABI, FLOW_RECIPIENT, buildClaimMessage, toBallot } from "@/lib/flowstate";

const ACCOUNT = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);
const exec = (target: Hex, data: Hex, value = 0n) =>
  encodeFunctionData({ abi: ACCOUNT, functionName: "execute", args: [target, value, data] });
const batch = (calls: { target: Hex; value: bigint; data: Hex }[]) =>
  encodeFunctionData({ abi: ACCOUNT, functionName: "executeBatch", args: [calls] });

const claim = encodeFunctionData({ abi: GOOD_DROPS_ABI, functionName: "claimWithProof", args: [1n, 2n, "0x1234"] });
const create = encodeFunctionData({ abi: GOOD_DROPS_ABI, functionName: "createDrop", args: [1, 2, 10n ** 18n, 3, "hint"] });
const reclaim = encodeFunctionData({ abi: GOOD_DROPS_ABI, functionName: "reclaimExpired", args: [1n] });
const approveDrops = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256] });
const approveOther = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: ["0x000000000000000000000000000000000000bEEF", maxUint256] });
const sendG = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: ["0x000000000000000000000000000000000000bEEF", 5n] });
const setMax = encodeFunctionData({ abi: GOOD_DROPS_ABI, functionName: "setMaxDropAmount", args: [1n] });

// Real callData from Alchemy's wallet_prepareCalls on Celo (execute to 0x…dEaD).
const REAL_DEAD = "0xb61d27f6000000000000000000000000000000000000000000000000000000000000dead000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000" as Hex;

describe("innerCalls", () => {
  it("reads execute, executeBatch and the executeUserOp prefix", () => {
    expect(innerCalls(exec(GOOD_DROPS_ADDRESS, claim))).toHaveLength(1);
    expect(innerCalls(batch([{ target: G_TOKEN_ADDRESS, value: 0n, data: approveDrops }, { target: GOOD_DROPS_ADDRESS, value: 0n, data: create }]))).toHaveLength(2);
    expect(innerCalls(`0x8dd7712f${exec(GOOD_DROPS_ADDRESS, claim).slice(2)}` as Hex)?.[0].target.toLowerCase()).toBe(GOOD_DROPS_ADDRESS.toLowerCase());
    expect(innerCalls(REAL_DEAD)?.[0].target.toLowerCase()).toBe("0x000000000000000000000000000000000000dead");
  });
  it("rejects garbage", () => {
    expect(innerCalls(undefined)).toBeNull();
    expect(innerCalls("0x")).toBeNull();
    expect(innerCalls("0xdeadbeef00")).toBeNull();
  });
});

describe("classify", () => {
  const c = (target: Hex, data: Hex, value = 0n) => classify({ target, data, value });
  it("knows every GoodDrops user action", () => {
    expect(c(GOOD_DROPS_ADDRESS, claim)).toBe("claim");
    expect(c(GOOD_DROPS_ADDRESS, create)).toBe("drop");
    expect(c(GOOD_DROPS_ADDRESS, reclaim)).toBe("manage");
    expect(c(G_TOKEN_ADDRESS, approveDrops)).toBe("approve");
    expect(c(G_TOKEN_ADDRESS, sendG)).toBe("transfer");
  });
  it("refuses admin calls, other spenders, other contracts and CELO value", () => {
    expect(c(GOOD_DROPS_ADDRESS, setMax)).toBeNull();
    expect(c(G_TOKEN_ADDRESS, approveOther)).toBeNull();
    expect(c("0x000000000000000000000000000000000000bEEF", claim)).toBeNull();
    expect(c(GOOD_DROPS_ADDRESS, claim, 1n)).toBeNull();
    expect(c(GOOD_DROPS_ADDRESS, "0x12345678")).toBeNull();
  });
});

describe("decide", () => {
  it("lets a verified human claim, drop and send G$", () => {
    expect(decide(exec(GOOD_DROPS_ADDRESS, claim), true)).toEqual({ ok: true, kinds: ["claim"] });
    expect(decide(exec(G_TOKEN_ADDRESS, sendG), true).ok).toBe(true);
  });
  it("lets a verified human drop and manage drops", () => {
    expect(decide(exec(G_TOKEN_ADDRESS, approveDrops), true).ok).toBe(true);
    expect(decide(exec(GOOD_DROPS_ADDRESS, create), true).ok).toBe(true);
    expect(decide(exec(GOOD_DROPS_ADDRESS, reclaim), true).ok).toBe(true);
  });
  it("sponsors nothing for an unverified wallet", () => {
    for (const data of [exec(G_TOKEN_ADDRESS, approveDrops), exec(GOOD_DROPS_ADDRESS, create), exec(GOOD_DROPS_ADDRESS, reclaim), exec(GOOD_DROPS_ADDRESS, claim), exec(G_TOKEN_ADDRESS, sendG)]) {
      expect(decide(data, false)).toEqual({ ok: false, reason: "needs_verification" });
    }
  });
  it("reports a non-GoodDrops call as such even when unverified", () => {
    expect(decide(REAL_DEAD, false)).toEqual({ ok: false, reason: "not_gooddrops" });
  });
  it("rejects a batch if any call is outside GoodDrops", () => {
    expect(decide(batch([
      { target: GOOD_DROPS_ADDRESS, value: 0n, data: claim },
      { target: "0x000000000000000000000000000000000000bEEF", value: 0n, data: "0x" },
    ]), true)).toEqual({ ok: false, reason: "not_gooddrops" });
  });
  it("rejects too many calls and the burn-address test call", () => {
    const five = Array.from({ length: 5 }, () => ({ target: GOOD_DROPS_ADDRESS as Hex, value: 0n, data: reclaim }));
    expect(decide(batch(five), true)).toEqual({ ok: false, reason: "call_count" });
    expect(decide(REAL_DEAD, true)).toEqual({ ok: false, reason: "not_gooddrops" });
  });
});

describe("isCelo", () => {
  it("accepts every encoding of 42220 only", () => {
    expect(isCelo(42220)).toBe(true);
    expect(isCelo("42220")).toBe(true);
    expect(isCelo("0xa4ec")).toBe(true);
    expect(isCelo("0xA4EC")).toBe(true);
    expect(isCelo(1)).toBe(false);
    expect(isCelo("0x1")).toBe(false);
    expect(isCelo(undefined)).toBe(false);
  });
});

describe("Flow State votes", () => {
  const voteFor = (recipient: Hex, amount: bigint) =>
    encodeFunctionData({ abi: FLOW_COUNCIL_ABI, functionName: "vote", args: [[{ recipient, amount }]] });
  const OTHER = "0x000000000000000000000000000000000000bEEF" as Hex;

  it("covers a vote that sets GoodDrops' points", () => {
    expect(classify({ target: FLOW_COUNCIL, value: 0n, data: voteFor(FLOW_RECIPIENT, 10n) })).toBe("vote");
    expect(decide(exec(FLOW_COUNCIL, voteFor(FLOW_RECIPIENT, 10n)), true)).toEqual({ ok: true, kinds: ["vote"] });
  });
  it("refuses votes for anyone else, mixed ballots, value, and other council calls", () => {
    expect(classify({ target: FLOW_COUNCIL, value: 0n, data: voteFor(OTHER, 10n) })).toBeNull();
    const mixed = encodeFunctionData({ abi: FLOW_COUNCIL_ABI, functionName: "vote", args: [[{ recipient: FLOW_RECIPIENT, amount: 5n }, { recipient: OTHER, amount: 5n }]] });
    expect(classify({ target: FLOW_COUNCIL, value: 0n, data: mixed })).toBeNull();
    const empty = encodeFunctionData({ abi: FLOW_COUNCIL_ABI, functionName: "vote", args: [[]] });
    expect(classify({ target: FLOW_COUNCIL, value: 0n, data: empty })).toBeNull();
    expect(classify({ target: FLOW_COUNCIL, value: 1n, data: voteFor(FLOW_RECIPIENT, 10n) })).toBeNull();
    const read = encodeFunctionData({ abi: FLOW_COUNCIL_ABI, functionName: "getVoter", args: [FLOW_RECIPIENT] });
    expect(classify({ target: FLOW_COUNCIL, value: 0n, data: read })).toBeNull();
    // The same vote sent to a different contract is not ours to pay for.
    expect(classify({ target: OTHER, value: 0n, data: voteFor(FLOW_RECIPIENT, 10n) })).toBeNull();
  });
  it("still needs a verified person", () => {
    expect(decide(exec(FLOW_COUNCIL, voteFor(FLOW_RECIPIENT, 10n)), false)).toEqual({ ok: false, reason: "needs_verification" });
  });
});

describe("Flow State claim message", () => {
  it("matches Flow State's format exactly", () => {
    expect(buildClaimMessage("0xAbC0000000000000000000000000000000000001", Date.UTC(2026, 10, 19, 12, 0, 5, 678))).toBe(
      "Claim voting rights in this Flow Council.\n\nCouncil: 0x889e0aadaa3f8b28a794ef70da147827c620a590\nChain: 42220\nWallet: 0xabc0000000000000000000000000000000000001\nIssued at: 2026-11-19T12:00:05Z",
    );
  });
  it("works out points for GoodDrops and what's left", () => {
    const b = toBallot({ account: "0x1", votingPower: 10n }, [{ recipient: FLOW_RECIPIENT, amount: 2n }, { recipient: "0x2", amount: 5n }]);
    expect(b).toEqual({ isVoter: true, votingPower: 10, forUs: 2, used: 7, available: 3 });
    expect(toBallot({ account: "0x0000000000000000000000000000000000000000", votingPower: 0n }, []).isVoter).toBe(false);
  });
});
