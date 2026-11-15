import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient, createTestClient, createWalletClient, http, parseAbi, parseEther, publicActions,
  decodeEventLog, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, G_TOKEN_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { signClaimProof } from "@/lib/claimProof";
import { readIdentityStatus } from "@/lib/identity";
import { IDENTITY_LINK_ABI, switchErrorMessage } from "@/lib/walletLink";
import { FORK_PORT } from "./anvil.setup";

// ── What this proves (switch-to-email) ────────────────────────────────────────
// The exact calls /switch-to-email makes, against the DEPLOYED GoodDollar
// identity and GoodDrops contracts on a local fork of Celo mainnet:
//   • a verified wallet links a fresh "email" account with connectAccount(address)
//   • the linked account then counts as verified AND can claim a GoodDrops drop
//   • every refusal reads as the sentence the page shows (unverified, twice,
//     already-verified target, lapsed)
//   • expired drops come back, then the whole G$ balance moves
//   • after the original wallet lapses, the link persists and the linked account
//     reads as "lapsed" (so the app sends it to renew, not to re-verify itself)
// Nothing is broadcast to the real chain; wallets are impersonated on the fork.

const RPC = `http://127.0.0.1:${FORK_PORT}`;
const ID = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const SUBGRAPH = process.env.NEXT_PUBLIC_SUBGRAPH_URL;
const G = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
const ADMIN_ABI = parseAbi(["function owner() view returns (address)", "function setGpsSigner(address)"]);

const test = createTestClient({ chain: celo, mode: "anvil", transport: http(RPC, { timeout: 90_000 }) }).extend(publicActions);
const pub = createPublicClient({ chain: celo, transport: http(RPC, { timeout: 90_000 }) });
const signerKey = generatePrivateKey();

let root: Address;      // the original, verified wallet ("MetaMask")
let other: Address;     // a different verified person
let funder: Address;    // someone holding G$, to fund test drops
const email = privateKeyToAccount(generatePrivateKey()).address; // the new email account

async function as<T>(who: Address, fn: (w: ReturnType<typeof createWalletClient>) => Promise<T>): Promise<T> {
  await test.impersonateAccount({ address: who });
  await test.setBalance({ address: who, value: parseEther("10") });
  try { return await fn(createWalletClient({ account: who, chain: celo, transport: http(RPC, { timeout: 90_000 }) })); }
  finally { await test.stopImpersonatingAccount({ address: who }); }
}
const ok = async (hash: Hex) => { const r = await pub.waitForTransactionReceipt({ hash }); expect(r.status).toBe("success"); return r; };
const gBal = (a: Address) => pub.readContract({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
const linkedTo = async (a: Address) => ((await pub.readContract({ address: ID, abi: IDENTITY_LINK_ABI, functionName: "connectedAccounts", args: [a] })) as string).toLowerCase();
const rootOf = async (a: Address) => ((await pub.readContract({ address: ID, abi: IDENTITY_LINK_ABI, functionName: "getWhitelistedRoot", args: [a] })) as string).toLowerCase();
const blockTime = async () => (await pub.getBlock()).timestamp;

/** What the page would show if this connectAccount were attempted. */
async function linkSays(from: Address, target: Address): Promise<string> {
  try {
    await pub.simulateContract({ account: from, address: ID, abi: IDENTITY_LINK_ABI, functionName: "connectAccount", args: [target] });
  } catch (e) { return switchErrorMessage(e); }
  throw new Error("expected connectAccount to be refused");
}

async function createDropAs(who: Address, amount: bigint, ttl: bigint): Promise<bigint> {
  return as(who, async (w) => {
    await ok(await w.writeContract({ account: who, chain: celo, address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, amount] }));
    const r = await ok(await w.writeContract({
      account: who, chain: celo, address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
      args: [6_524_400, 3_379_200, amount, Number((await blockTime()) + ttl), "e2e switch"],
    }));
    for (const log of r.logs) {
      try {
        const ev = decodeEventLog({ abi: GOOD_DROPS_ABI, data: log.data, topics: log.topics });
        if (ev.eventName === "DropCreated") return (ev.args as { dropId: bigint }).dropId;
      } catch { /* another contract's log */ }
    }
    throw new Error("no DropCreated");
  });
}

beforeAll(async () => {
  const owner = await pub.readContract({ address: GOOD_DROPS_ADDRESS, abi: ADMIN_ABI, functionName: "owner" });
  await as(owner, async (w) => ok(await w.writeContract({
    account: owner, chain: celo, address: GOOD_DROPS_ADDRESS, abi: ADMIN_ABI, functionName: "setGpsSigner", args: [privateKeyToAccount(signerKey).address],
  })));

  if (!SUBGRAPH) throw new Error("NEXT_PUBLIC_SUBGRAPH_URL is required (it's in .env.local)");
  const res = await fetch(SUBGRAPH, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ drops(first: 300, orderBy: claimedAt, orderDirection: desc, where: { status: 1 }) { claimer dropper } }" }),
  });
  const people = new Set<Address>();
  for (const d of (await res.json()).data?.drops ?? []) { people.add(d.claimer); people.add(d.dropper); }
  for (const a of people) {
    const self = (await rootOf(a)) === a.toLowerCase() && (await linkedTo(a)) === ZERO;
    if (!root && self) { root = a; continue; }
    if (!other && self && a !== root) { other = a; continue; }
    if (!funder && a !== root && a !== other && (await gBal(a)) >= 300n * G) funder = a;
    if (root && other && funder) break;
  }
  if (!root || !other || !funder) throw new Error("couldn't find verified wallets and a funder among recent players");
});

describe("switch to email (forked mainnet)", () => {
  it("an unverified wallet can't link anything", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    expect(await linkSays(stranger, email)).toMatch(/verification isn't active/);
  });

  it("the verified wallet links the email account, which then counts as the same person", async () => {
    expect(await linkedTo(email)).toBe(ZERO);
    await as(root, async (w) => {
      const { request } = await pub.simulateContract({ account: root, address: ID, abi: IDENTITY_LINK_ABI, functionName: "connectAccount", args: [email] });
      await ok(await w.writeContract({ ...request, account: root, chain: celo }));
    });
    expect(await linkedTo(email)).toBe(root.toLowerCase());
    expect(await rootOf(email)).toBe(root.toLowerCase());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await readIdentityStatus(pub as any, email)).state).toBe("verified");
  });

  it("linking twice, or linking an already-verified wallet, is refused in plain words", async () => {
    expect(await linkSays(root, email)).toMatch(/already linked/);
    expect(await linkSays(root, other)).toMatch(/already verified by itself/);
  });

  it("the linked email account can claim a GoodDrops drop", async () => {
    const id = await createDropAs(funder, 25n * G, 2n * 3600n);
    const before = await gBal(email);
    const deadline = (await blockTime()) + 90n;
    const sig = await signClaimProof(signerKey, id, email, deadline);
    await as(email, async (w) => {
      const { request } = await pub.simulateContract({ account: email, address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "claimWithProof", args: [id, deadline, sig] });
      await ok(await w.writeContract({ ...request, account: email, chain: celo }));
    });
    // G$ on Celo can stream (Superfluid), so compare with a dust tolerance.
    expect(await gBal(email) - before - 25n * G).toBeLessThan(G / 10n);
  });

  it("expired drops come back to the old wallet, then its whole G$ balance moves", async () => {
    // Give the old wallet two drops of its own, then let them expire.
    await as(funder, async (w) => ok(await w.writeContract({ account: funder, chain: celo, address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [root, 60n * G] })));
    const a = await createDropAs(root, 20n * G, 2n * 3600n);
    const b = await createDropAs(root, 30n * G, 2n * 3600n);
    await test.increaseTime({ seconds: 3 * 3600 });
    await test.mine({ blocks: 1 });

    const rootBefore = await gBal(root);
    await as(root, async (w) => {
      const { request } = await pub.simulateContract({ account: root, address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "reclaimManyExpired", args: [[a, b]] });
      await ok(await w.writeContract({ ...request, account: root, chain: celo }));
    });
    const got = (await gBal(root)) - rootBefore - 50n * G;
    expect(got >= 0n && got < G / 10n).toBe(true);

    // A second reclaim of the same drops is refused (harmless to retry).
    await expect(pub.simulateContract({ account: root, address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "reclaimManyExpired", args: [[a, b]] })).rejects.toThrow();

    const all = await gBal(root);
    const emailBefore = await gBal(email);
    await as(root, async (w) => ok(await w.writeContract({ account: root, chain: celo, address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "transfer", args: [email, all] })));
    expect(await gBal(root)).toBeLessThan(G / 10n); // stream dust at most
    expect(await gBal(email) - emailBefore - all).toBeLessThan(G / 10n);
  });

  it("when the old wallet lapses, the link stays and the email account reads as lapsed (renew, not re-verify)", async () => {
    await test.increaseTime({ seconds: 400 * 86_400 });
    await test.mine({ blocks: 1 });
    expect(await rootOf(root)).toBe(ZERO);
    expect(await rootOf(email)).toBe(ZERO);
    expect(await linkedTo(email)).toBe(root.toLowerCase());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await readIdentityStatus(pub as any, email)).state).toBe("lapsed");
    // And a lapsed wallet can't link until it renews: the page's renew step.
    const fresh = privateKeyToAccount(generatePrivateKey()).address;
    expect(await linkSays(root, fresh)).toMatch(/verification isn't active/);
  });
});
