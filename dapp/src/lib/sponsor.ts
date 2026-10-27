"use client";
// Gas sponsorship for Magic (email / Google) wallets.
//
// How it works: Magic's Smart Account extension upgrades the user's own address
// in place with EIP-7702 (same address, so GoodDollar identity, balances and
// claim history are untouched) and sends calls through Alchemy's bundler, which
// pays the gas under our Gas Manager policy. Verified on Celo mainnet, Oct 2026.
//
// Who it covers: only wallets created through OUR Magic key. MetaMask, MiniPay
// and other injected wallets cannot delegate to Alchemy's account contract, so
// they keep the normal path (their own CELO, or the faucet in ensureGas).
//
// Safety rules this file enforces:
//   1. Never run a call twice. If a sponsored send throws, we first look on-chain
//      for the user operation; only if it never landed do we fall back.
//   2. A failed sponsorship is often just the call itself reverting (drop already
//      claimed, expired...). We simulate it from the user's address so the user
//      sees the real reason instead of a pointless fallback and faucet top-up.
//   3. A bundle can succeed while the user's call inside it reverted. We read the
//      EntryPoint's UserOperationEvent and surface the inner revert as an error.
//   4. If sponsorship is failing (credits used up, policy cap hit, outage), stop
//      trying for a while so every tap isn't slowed by a doomed attempt.

import { Magic } from "magic-sdk";
import { SmartAccountExtension } from "@magic-ext/smart-account";
import {
  decodeErrorResult, decodeEventLog, encodeFunctionData, parseAbi,
  type Abi, type Address, type Hex, type TransactionReceipt,
} from "viem";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ABI, ERC20_ABI } from "@/lib/contracts";
import { decideCalls, classify } from "@/lib/sponsorPolicy";

const CELO_CHAIN_ID = 42220;
const API_KEY   = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "";
const POLICY_ID = process.env.NEXT_PUBLIC_ALCHEMY_POLICY_ID ?? "";
const MAGIC_KEY = process.env.NEXT_PUBLIC_MAGIC_KEY ?? "";

/** Build-time switch: all three keys present and not explicitly disabled. */
export const SPONSOR_CONFIGURED =
  !!API_KEY && !!POLICY_ID && !!MAGIC_KEY && process.env.NEXT_PUBLIC_SPONSOR_DISABLED !== "1";

/** ERC-4337 EntryPoint v0.7, which Alchemy's bundler uses on Celo. */
export const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ENTRY_POINT_EVENTS = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
]);
const USER_OP_EVENT = ENTRY_POINT_EVENTS[0];

/** Errors the user's call can revert with, for readable messages. */
const REVERT_ABI = [...GOOD_DROPS_ABI, ...ERC20_ABI].filter((x) => x.type === "error") as Abi;

const SEND_TIMEOUT_MS  = 45_000;  // Magic + bundler normally take 3–15s; claim proofs live 90s
const LANDED_WAIT_MS   = 15_000;  // after a throw, how long we look for the op on-chain
const BREAKER_MS       = 10 * 60_000;
const BREAKER_KEY      = "gd:sponsor-off-until";

// ── Magic instance with the Smart Account extension ─────────────────────────
// Separate from the wagmi connector's instance, but Magic sessions are shared
// per API key + origin, so a user signed in through the app is signed in here.
// We only ever ASK whether they're signed in; this file never shows Magic UI.
let magic: Magic<[SmartAccountExtension]> | null = null;
function getSponsorMagic() {
  if (!SPONSOR_CONFIGURED || typeof window === "undefined") return null;
  if (!magic) {
    magic = new Magic(MAGIC_KEY, {
      network: { rpcUrl: "https://forno.celo.org", chainId: CELO_CHAIN_ID },
      extensions: [new SmartAccountExtension({ apiKey: API_KEY, paymasterPolicyId: POLICY_ID })],
    });
  }
  return magic;
}

// Which address the Magic session belongs to, cached for a few minutes so a
// claim never waits on an iframe round-trip. A stale entry is harmless: the
// connected address must still match, and a failed send falls back safely.
let sessionCache: { at: number; address: string | null } | null = null;
let sessionLookup: Promise<string | null> | null = null;
function magicSessionAddress(): Promise<string | null> {
  if (sessionCache && Date.now() - sessionCache.at < 5 * 60_000) return Promise.resolve(sessionCache.address);
  // Every component using the hook asks at once on mount; share one lookup.
  sessionLookup ??= lookupSession().finally(() => { sessionLookup = null; });
  return sessionLookup;
}
async function lookupSession(): Promise<string | null> {
  const m = getSponsorMagic();
  if (!m) return null;
  try {
    let address: string | null = null;
    if (await withTimeout(m.user.isLoggedIn(), 8_000)) {
      const info = (await withTimeout(m.user.getInfo(), 8_000)) as {
        publicAddress?: string | null; wallets?: { ethereum?: { publicAddress?: string | null } };
      };
      address = (info.publicAddress ?? info.wallets?.ethereum?.publicAddress ?? null)?.toLowerCase() ?? null;
    }
    sessionCache = { at: Date.now(), address };
    return address;
  } catch {
    sessionCache = null;
    return null;
  }
}

// ── Circuit breaker ──────────────────────────────────────────────────────────
let offUntil = 0;
function breakerOpen(): boolean {
  if (Date.now() < offUntil) return true;
  try { offUntil = Number(sessionStorage.getItem(BREAKER_KEY) ?? 0); } catch { /* storage blocked */ }
  return Date.now() < offUntil;
}
function tripBreaker() {
  offUntil = Date.now() + BREAKER_MS;
  try { sessionStorage.setItem(BREAKER_KEY, String(offUntil)); } catch { /* storage blocked */ }
}

/**
 * Should this write be sponsored? True only for a Magic-connected wallet whose
 * Magic session is OUR key's session for the same address (a partner's Magic
 * login uses their key and is excluded), on a healthy sponsor.
 */
export async function canSponsor(address: string | undefined, connectorId: string | undefined): Promise<boolean> {
  if (!SPONSOR_CONFIGURED || !address || connectorId !== "magic" || breakerOpen()) return false;
  return (await magicSessionAddress()) === address.toLowerCase();
}

export type SponsoredCall = { to: Address; data: Hex; value?: bigint };

// GoodDollar identity, read in the browser (the server helper pulls in Redis).
const IDENTITY: Address = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";
const IDENTITY_ABI = parseAbi(["function getWhitelistedRoot(address user) view returns (address)"]);
const verifiedCache = new Map<string, { at: number; ok: boolean }>();
async function isVerifiedClient(address: Address): Promise<boolean> {
  const k = address.toLowerCase();
  const hit = verifiedCache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ok;
  try {
    const root = await publicClient.readContract({ address: IDENTITY, abi: IDENTITY_ABI, functionName: "getWhitelistedRoot", args: [address] });
    const ok = !/^0x0{40}$/i.test(root);
    verifiedCache.set(k, { at: Date.now(), ok });
    return ok;
  } catch {
    return false; // unknown: skip sponsorship rather than wait on a likely refusal
  }
}

/**
 * Would our webhook approve these calls? Mirrors it exactly (same rules module)
 * so the app never waits on a sponsorship that is sure to be refused. The
 * identity read is skipped for calls that could never be sponsored anyway.
 */
export async function policyAllows(sender: Address, calls: SponsoredCall[]): Promise<boolean> {
  const inner = calls.map((c) => ({ target: c.to, value: c.value ?? 0n, data: c.data }));
  if (inner.some((c) => classify(c) === null)) return false;
  return decideCalls(inner, await isVerifiedClient(sender)).ok;
}

export type WriteParams = {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export function toCall(p: WriteParams): SponsoredCall {
  return {
    to: p.address,
    data: encodeFunctionData({ abi: p.abi as Abi, functionName: p.functionName, args: p.args ?? [] } as never),
    value: p.value,
  };
}

/** Thrown when the user's call itself reverted; never retried another way. */
export class CallRevertedError extends Error {
  constructor(public readonly revert: { name: string; reason?: string } | null) {
    // "error: Name()" is what friendlyClaimError reads first.
    super(
      revert?.reason ? `Execution reverted: ${revert.reason}`
      : revert ? `Execution reverted with error: ${revert.name}()`
      : "Execution reverted.",
    );
    this.name = "CallRevertedError";
  }
}

/** Thrown when sponsorship didn't happen and nothing landed: safe to fall back. */
export class SponsorUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Gas sponsorship unavailable: ${reason}`);
    this.name = "SponsorUnavailableError";
  }
}

function decodeRevert(data: Hex | undefined): { name: string; reason?: string } | null {
  if (!data || data === "0x") return null;
  try {
    const d = decodeErrorResult({ abi: REVERT_ABI, data });
    // Plain require("...") strings decode as Error(string).
    if (d.errorName === "Error" && typeof d.args?.[0] === "string") return { name: "Error", reason: d.args[0] };
    return { name: d.errorName };
  } catch { return null; }
}

/** The user op for `sender` in this receipt, if any. */
function userOpIn(receipt: TransactionReceipt, sender: string) {
  let event: { success: boolean; userOpHash: Hex } | null = null;
  let revert: Hex | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ENTRY_POINT.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: ENTRY_POINT_EVENTS, data: log.data, topics: log.topics });
      if ((d.args.sender as string).toLowerCase() !== sender) continue;
      if (d.eventName === "UserOperationEvent") event = { success: d.args.success, userOpHash: d.args.userOpHash };
      else revert = d.args.revertReason;
    } catch { /* another EntryPoint event */ }
  }
  return event ? { ...event, revert } : null;
}

/** Look on-chain for a user op from `sender` mined at or after `fromBlock`. */
async function findLandedOp(sender: Address, fromBlock: bigint, waitMs: number): Promise<Hex | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const logs = await publicClient.getLogs({
        address: ENTRY_POINT, event: USER_OP_EVENT, args: { sender }, fromBlock, toBlock: "latest",
      });
      if (logs.length) return logs[logs.length - 1].transactionHash;
    } catch { /* RPC blip: keep looking until the deadline */ }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 2_500));
  }
}

/** Resolve a landed bundle: return its hash if the user's call succeeded. */
async function settle(hash: Hex, sender: string): Promise<Hex> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  const op = userOpIn(receipt, sender);
  if (receipt.status !== "success" || !op) throw new CallRevertedError(null);
  if (!op.success) throw new CallRevertedError(decodeRevert(op.revert));
  return hash;
}

/**
 * Send calls with gas paid by the policy. Atomic: all calls succeed or none do.
 * Resolves with the transaction hash once mined and the user's calls succeeded.
 *
 * Throws CallRevertedError when the call itself reverts (show it to the user),
 * SponsorUnavailableError when nothing was sent (caller may fall back), and
 * rethrows anything else only when it can't be sure whether the op landed.
 */
export async function sendSponsored(sender: Address, calls: SponsoredCall[], simulate: () => Promise<unknown>): Promise<Hex> {
  const m = getSponsorMagic();
  if (!m) throw new SponsorUnavailableError("not configured");
  const who = sender.toLowerCase();
  // +1: the op can't be in a block that already exists, and an earlier step's op
  // (the approve before a createDrop) may be in this one.
  let fromBlock: bigint;
  try {
    fromBlock = (await publicClient.getBlockNumber()) + 1n;
  } catch {
    throw new SponsorUnavailableError("rpc"); // nothing sent yet: safe to fall back
  }

  let hash: Hex | undefined;
  try {
    const res = await withTimeout(m.smartAccount.sendTransaction({
      chainId: CELO_CHAIN_ID,
      calls: calls.map((c) => ({ to: c.to, data: c.data, value: (c.value ?? 0n).toString() })),
    }), SEND_TIMEOUT_MS);
    hash = res.transactionHash as Hex | undefined;
  } catch (e) {
    // Rule 1: did it land anyway (timeout, dropped connection after submit)?
    const landed = await findLandedOp(sender, fromBlock, LANDED_WAIT_MS);
    if (landed) return settle(landed, who);
    // A hang is different: the op may still be pending in the bundler, so a
    // fallback could run the call twice (two transfers, two drops). Look a
    // while longer, then stop and say so instead of retrying another way.
    if (e instanceof Error && e.message === "timeout") {
      tripBreaker();
      const late = await findLandedOp(sender, fromBlock, 30_000);
      if (late) return settle(late, who);
      throw new Error("This is taking longer than usual. Check your activity before trying again.");
    }
    // Rule 2: is it the call itself? Simulate from the user's own address; a
    // real revert (AlreadyClaimed, DropExpired, not enough G$...) throws here.
    await simulate();
    tripBreaker();
    throw new SponsorUnavailableError(e instanceof Error ? e.message : String(e));
  }

  if (!hash) {
    const landed = await findLandedOp(sender, fromBlock, 60_000);
    if (!landed) throw new Error("Your transaction was sent but hasn't confirmed yet. Check again in a minute.");
    hash = landed;
  }
  return settle(hash, who);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Test hooks: reset module state between unit tests. */
export const __test = {
  reset() { offUntil = 0; sessionCache = null; sessionLookup = null; magic = null; verifiedCache.clear(); },
  tripBreaker, breakerOpen, userOpIn, decodeRevert,
};
