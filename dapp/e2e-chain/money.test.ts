import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient, createTestClient, createWalletClient, http, parseAbi, parseEther, publicActions,
  decodeEventLog, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { signClaimProof } from "@/lib/claimProof";
import { friendlyClaimError, extractErrorText } from "@/lib/claimErrors";
import { writeFileSync } from "node:fs";
import { FORK_PORT } from "./anvil.setup";

// ── What this proves ──────────────────────────────────────────────────────────
// The app's real contract ABI and the app's real proof signer, driving the
// DEPLOYED GoodDrops contract on a local fork of Celo mainnet:
//   create → claim with a GPS proof → the money moves; plus every guard
//   (replay, wrong signer, expired proof, self-claim, unverified hunter),
//   reclaim after expiry, extend, and a plain G$ transfer (shop payment).
//
// Safety: the fork's gpsSigner is swapped for a throwaway key generated here,
// so no proof from this suite can ever be valid on mainnet. The dropper is a
// freshly generated wallet; the hunter is an existing face-verified wallet
// IMPERSONATED on the fork (no key needed, nothing broadcast).

const RPC = `http://127.0.0.1:${FORK_PORT}`;
const ID = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const SUBGRAPH = process.env.NEXT_PUBLIC_SUBGRAPH_URL;
const G = 10n ** 18n;

const ADMIN_ABI = parseAbi([
  "function owner() view returns (address)",
  "function setGpsSigner(address)",
  "function gpsSigner() view returns (address)",
]);
const IDENTITY_ABI = parseAbi(["function getWhitelistedRoot(address) view returns (address)"]);

const test = createTestClient({ chain: celo, mode: "anvil", transport: http(RPC) }).extend(publicActions);
const pub = createPublicClient({ chain: celo, transport: http(RPC) });

const testSignerKey = generatePrivateKey();
const dropperKey = generatePrivateKey();
const dropper = privateKeyToAccount(dropperKey);
const dropperWallet = createWalletClient({ account: dropper, chain: celo, transport: http(RPC) });

let hunter: Address;
let funder: Address;

async function asImpersonated<T>(who: Address, fn: (w: ReturnType<typeof createWalletClient>) => Promise<T>): Promise<T> {
  await test.impersonateAccount({ address: who });
  await test.setBalance({ address: who, value: parseEther("10") });
  try {
    return await fn(createWalletClient({ account: who, chain: celo, transport: http(RPC) }));
  } finally {
    await test.stopImpersonatingAccount({ address: who });
  }
}

async function waitOk(hash: Hex) {
  const r = await pub.waitForTransactionReceipt({ hash });
  expect(r.status).toBe("success");
  return r;
}

async function now(): Promise<bigint> {
  return (await pub.getBlock()).timestamp;
}

async function gBalance(a: Address) {
  return pub.readContract({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
}

async function createDrop(amount: bigint, ttlSeconds: bigint, hint = "e2e"): Promise<bigint> {
  await waitOk(await dropperWallet.writeContract({
    address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, amount],
  }));
  const r = await waitOk(await dropperWallet.writeContract({
    address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
    args: [6_524_400, 3_379_200, amount, Number((await now()) + ttlSeconds), hint],
  }));
  for (const log of r.logs) {
    try {
      const ev = decodeEventLog({ abi: GOOD_DROPS_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "DropCreated") return (ev.args as { dropId: bigint }).dropId;
    } catch { /* other contract's log */ }
  }
  throw new Error("no DropCreated event");
}

async function claimAs(who: Address, dropId: bigint, opts: { key?: Hex; deadline?: bigint } = {}) {
  const deadline = opts.deadline ?? (await now()) + 90n;
  const sig = await signClaimProof(opts.key ?? testSignerKey, dropId, who, deadline);
  return asImpersonated(who, async (w) => {
    // Simulate first, as the app's claim flow does: a bad proof fails here with
    // the contract's own error name instead of mining a reverted transaction.
    const { request } = await pub.simulateContract({
      account: who, address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "claimWithProof", args: [dropId, deadline, sig],
    });
    return w.writeContract({ ...request, account: who, chain: celo });
  });
}

/** Run a failing call and return what the app would tell the person. */
async function userSees(p: Promise<unknown>) {
  try { await p; } catch (e) {
    if (process.env.E2E_DEBUG) writeFileSync(`/tmp/e2e-err-${Date.now()}.txt`, extractErrorText(e));
    return friendlyClaimError(e).kind;
  }
  throw new Error("expected the call to fail");
}

/** Recent claimers from the subgraph: proven humans, likely still verified. */
async function recentClaimers(): Promise<Address[]> {
  if (!SUBGRAPH) throw new Error("NEXT_PUBLIC_SUBGRAPH_URL is required (it's in .env.local)");
  const res = await fetch(SUBGRAPH, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ drops(first: 200, orderBy: claimedAt, orderDirection: desc, where: { status: 1 }) { claimer dropper } }" }),
  });
  const j = await res.json();
  const out = new Set<Address>();
  for (const d of j.data?.drops ?? []) { out.add(d.claimer); out.add(d.dropper); }
  return [...out];
}

beforeAll(async () => {
  // 1. Throwaway proof signer, installed on the fork only.
  const owner = await pub.readContract({ address: GOOD_DROPS_ADDRESS, abi: ADMIN_ABI, functionName: "owner" });
  const signerAddr = privateKeyToAccount(testSignerKey).address;
  await asImpersonated(owner, async (w) => waitOk(await w.writeContract({
    account: owner, chain: celo, address: GOOD_DROPS_ADDRESS, abi: ADMIN_ABI, functionName: "setGpsSigner", args: [signerAddr],
  })));
  expect(await pub.readContract({ address: GOOD_DROPS_ADDRESS, abi: ADMIN_ABI, functionName: "gpsSigner" })).toBe(signerAddr);

  // 2. A verified hunter and a G$ funder, discovered from recent activity.
  const candidates = await recentClaimers();
  for (const a of candidates) {
    const root = await pub.readContract({ address: ID, abi: IDENTITY_ABI, functionName: "getWhitelistedRoot", args: [a] });
    if (!hunter && root !== "0x0000000000000000000000000000000000000000") hunter = a;
    if (!funder && a.toLowerCase() !== hunter?.toLowerCase() && (await gBalance(a)) >= 400n * G) funder = a;
    if (hunter && funder) break;
  }
  if (!hunter) throw new Error("no currently-verified wallet among recent claimers");
  if (!funder) throw new Error("no recent participant holding 400 G$ to fund the test wallet");

  // 3. Fund the freshly generated dropper wallet (fork only).
  await test.setBalance({ address: dropper.address, value: parseEther("10") });
  await asImpersonated(funder, async (w) => waitOk(await w.writeContract({
    account: funder, chain: celo, address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [dropper.address, 400n * G],
  })));
  expect(await gBalance(dropper.address)).toBe(400n * G);
});

describe("GoodDrops money paths (forked mainnet)", () => {
  it("creates a drop: G$ moves into escrow and the drop is readable", async () => {
    const lockedBefore = await pub.readContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "totalLocked" }) as bigint;
    const balBefore = await gBalance(dropper.address);
    const id = await createDrop(100n * G, 2n * 3600n, "e2e create");
    expect(await gBalance(dropper.address)).toBe(balBefore - 100n * G);
    expect(await pub.readContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "totalLocked" })).toBe(lockedBefore + 100n * G);
    const d = await pub.readContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [id] }) as { dropper: Address; amount: bigint; status: number };
    expect(d.dropper.toLowerCase()).toBe(dropper.address.toLowerCase());
    expect(d.amount).toBe(100n * G);
    expect(Number(d.status)).toBe(0);
  });

  it("a verified hunter claims with a valid proof and receives the G$", async () => {
    const id = await createDrop(50n * G, 2n * 3600n, "e2e claim");
    const before = await gBalance(hunter);
    await waitOk(await claimAs(hunter, id));
    expect(await gBalance(hunter)).toBe(before + 50n * G);
    const d = await pub.readContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [id] }) as { claimer: Address; status: number };
    expect(d.claimer.toLowerCase()).toBe(hunter.toLowerCase());
    expect(Number(d.status)).toBe(1);
  });

  it("rejects replayed, foreign-signed, expired, self and unverified claims — with the right message", async () => {
    const id = await createDrop(10n * G, 2n * 3600n, "e2e guards");

    // Wrong signer (a proof not issued by our server): decodes to the contract's error.
    await expect(claimAs(hunter, id, { key: generatePrivateKey() })).rejects.toThrow(/InvalidGpsProof/);
    // Expired proof → "tap Try again" (transient, not terminal).
    expect(await userSees(claimAs(hunter, id, { deadline: (await now()) - 1n }))).toBe("network");
    // The dropper can't claim their own drop.
    const deadline = (await now()) + 90n;
    const selfSig = await signClaimProof(testSignerKey, id, dropper.address, deadline);
    expect(await userSees(pub.simulateContract({
      account: dropper.address, address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "claimWithProof", args: [id, deadline, selfSig],
    }))).toBe("self");
    // A fresh, unverified wallet is told to verify.
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    expect(await userSees(claimAs(stranger, id))).toBe("verify");

    // Valid claim goes through once; a second hunter is told someone beat them to it.
    await waitOk(await claimAs(hunter, id));
    expect(await userSees(claimAs(hunter, id))).toBe("claimed");
  });

  it("an expired drop can't be claimed, and its dropper reclaims the G$", async () => {
    const id = await createDrop(20n * G, 3600n + 300n, "e2e reclaim");
    await test.increaseTime({ seconds: 3 * 3600 });
    await test.mine({ blocks: 1 });
    expect(await userSees(claimAs(hunter, id))).toBe("expired");
    const before = await gBalance(dropper.address);
    await waitOk(await dropperWallet.writeContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "reclaimExpired", args: [id],
    }));
    expect(await gBalance(dropper.address)).toBe(before + 20n * G);
  });

  it("an expired drop can be extended and then claimed", async () => {
    const id = await createDrop(15n * G, 3600n + 300n, "e2e extend");
    await test.increaseTime({ seconds: 3 * 3600 });
    await test.mine({ blocks: 1 });
    await waitOk(await dropperWallet.writeContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "extendExpiry",
      args: [id, Number((await now()) + 2n * 3600n)],
    }));
    const before = await gBalance(hunter);
    await waitOk(await claimAs(hunter, id));
    expect(await gBalance(hunter)).toBe(before + 15n * G);
  });

  it("a shop payment is a plain G$ transfer that lands in the shop's wallet", async () => {
    const shop = privateKeyToAccount(generatePrivateKey()).address;
    await waitOk(await dropperWallet.writeContract({
      address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [shop, 25n * G],
    }));
    expect(await gBalance(shop)).toBe(25n * G);
  });
});
