import { describe, it, expect, beforeAll } from "vitest";
import { encodeFunctionData, parseAbi, maxUint256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ERC20_ABI, GOOD_DROPS_ABI, GOOD_DROPS_ADDRESS, G_TOKEN_ADDRESS } from "@/lib/contracts";

// The Gas Manager webhook, end to end over HTTP against a throwaway Redis.
// Verification status is read from Celo mainnet (read-only).
const BASE = process.env.E2E_API_BASE ?? "http://localhost:3105";
if (/gooddrops\.xyz/.test(BASE)) throw new Error("Refusing to run against production");
const SECRET = process.env.SPONSOR_WEBHOOK_SECRET ?? "";
const POLICY = process.env.NEXT_PUBLIC_ALCHEMY_POLICY_ID ?? "";

const VERIFIED = "0x045EF6d83b0216802095e711437f0Db520e06a56"; // GoodDollar-verified on mainnet
// Start the test server with a small cap so the cap test is quick (README).
const CAP = Number(process.env.E2E_SPONSOR_CAP ?? 6);
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;

const ACCOUNT = parseAbi(["function execute(address target, uint256 value, bytes data)"]);
const exec = (target: Hex, data: Hex) => encodeFunctionData({ abi: ACCOUNT, functionName: "execute", args: [target, 0n, data] });
const CLAIM = exec(GOOD_DROPS_ADDRESS, encodeFunctionData({ abi: GOOD_DROPS_ABI, functionName: "claimWithProof", args: [1n, 2n, "0x12"] }));
const APPROVE = exec(G_TOKEN_ADDRESS, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256] }));
const DEAD = exec("0x000000000000000000000000000000000000dEaD", "0x");

let nonce = 1000;
async function ask(sender: string, callData: Hex, o: { key?: string; chainId?: unknown; policyId?: string; nonce?: string } = {}) {
  const res = await fetch(`${BASE}/api/sponsor/approve?key=${encodeURIComponent(o.key ?? SECRET)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userOperation: { sender, nonce: o.nonce ?? `0x${(nonce++).toString(16)}`, callData },
      policyId: o.policyId ?? POLICY,
      chainId: o.chainId ?? "0xa4ec",
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).approved as boolean;
}

beforeAll(async () => {
  expect(SECRET, "SPONSOR_WEBHOOK_SECRET must be set").not.toBe("");
  await fetch(`${BASE}/api/sponsor/approve`, { method: "POST" }); // compile the route once
});

describe("sponsor webhook", () => {
  it("rejects a missing or wrong secret", async () => {
    expect(await ask(VERIFIED, CLAIM, { key: "" })).toBe(false);
    expect(await ask(VERIFIED, CLAIM, { key: SECRET.slice(0, -1) + "x" })).toBe(false);
  });

  it("rejects another chain or another policy", async () => {
    expect(await ask(VERIFIED, CLAIM, { chainId: "0x1" })).toBe(false);
    expect(await ask(VERIFIED, CLAIM, { policyId: "someone-elses-policy" })).toBe(false);
  });

  it("approves a verified human's claim, accepting decimal chain ids too", async () => {
    expect(await ask(VERIFIED, CLAIM)).toBe(true);
    expect(await ask(VERIFIED, CLAIM, { chainId: 42220 })).toBe(true);
  });

  it("refuses calls outside GoodDrops, even for verified people", async () => {
    expect(await ask(VERIFIED, DEAD)).toBe(false);
  });

  it("sponsors nothing for an unverified wallet, not even dropping", async () => {
    const w = fresh();
    expect(await ask(w, APPROVE)).toBe(false);
    expect(await ask(w, CLAIM)).toBe(false);
  });

  it("counts the same operation once, then caps the person per day", async () => {
    // Earlier tests used 2 of VERIFIED's slots.
    const used = 2;
    for (let i = 0; i < 5; i++) expect(await ask(VERIFIED, APPROVE, { nonce: "0xabc" })).toBe(true);
    for (let i = 0; i < CAP - used - 1; i++) expect(await ask(VERIFIED, APPROVE)).toBe(true);
    expect(await ask(VERIFIED, APPROVE)).toBe(false);
    expect(await ask(VERIFIED, APPROVE)).toBe(false);
    // The op that was already approved stays approved if Alchemy asks again.
    expect(await ask(VERIFIED, APPROVE, { nonce: "0xabc" })).toBe(true);
  });
});
