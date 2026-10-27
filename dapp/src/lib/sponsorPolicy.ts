// What GoodDrops is willing to pay gas for. Pure, so it's unit-tested and the
// webhook route stays a thin shell around it.
//
// Why this exists: the Alchemy key and policy ID ship to the browser (Magic's
// extension runs there), and a domain allowlist only binds browsers, not curl.
// Without a server-side rule anyone could spend our sponsorship credits on any
// Celo transaction. Alchemy asks our webhook before sponsoring each user
// operation; this file decides by decoding exactly what the account will run.

import { decodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { ERC20_ABI, GOOD_DROPS_ABI, GOOD_DROPS_ADDRESS, G_TOKEN_ADDRESS } from "@/lib/contracts";

/** Alchemy Modular Account v2 (the EIP-7702 delegate) entry points. */
const ACCOUNT_ABI = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);
/** ERC-4337 v0.7 `executeUserOp` prefix: the real call follows the selector. */
const EXECUTE_USER_OP = "0x8dd7712f";

export const MAX_CALLS = 4;

export type InnerCall = { target: Address; value: bigint; data: Hex };
export type CallKind = "claim" | "drop" | "manage" | "approve" | "transfer";

/** The calls a user operation will make, or null if we can't read it. */
export function innerCalls(callData: Hex | undefined): InnerCall[] | null {
  if (!callData || callData.length < 10) return null;
  let data = callData.toLowerCase() as Hex;
  if (data.startsWith(EXECUTE_USER_OP)) data = `0x${data.slice(10)}` as Hex;
  try {
    const d = decodeFunctionData({ abi: ACCOUNT_ABI, data });
    if (d.functionName === "execute") {
      const [target, value, inner] = d.args;
      return [{ target, value, data: inner }];
    }
    return d.args[0].map((c) => ({ target: c.target, value: c.value, data: c.data }));
  } catch {
    return null;
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What a single call does, or null if we don't sponsor it. */
export function classify(call: InnerCall): CallKind | null {
  if (call.value !== 0n) return null; // never pay to move CELO
  try {
    if (same(call.target, GOOD_DROPS_ADDRESS)) {
      const fn = decodeFunctionData({ abi: GOOD_DROPS_ABI, data: call.data }).functionName;
      if (fn === "claimWithProof" || fn === "claim") return "claim";
      if (fn === "createDrop" || fn === "createManyDrops") return "drop";
      if (fn === "reclaimExpired" || fn === "reclaimManyExpired" || fn === "extendExpiry" || fn === "extendManyExpiry") return "manage";
      return null; // owner/admin functions
    }
    if (same(call.target, G_TOKEN_ADDRESS)) {
      const d = decodeFunctionData({ abi: ERC20_ABI, data: call.data });
      if (d.functionName === "approve") return same(d.args[0] as string, GOOD_DROPS_ADDRESS) ? "approve" : null;
      if (d.functionName === "transfer") return "transfer";
      return null;
    }
  } catch { /* undecodable data */ }
  return null;
}

/**
 * Only GoodDollar-verified people are sponsored, the same rule the app already
 * applies to dropping and claiming. It is also what makes the credits hard to
 * drain: a fresh address costs nothing, a verified human does not.
 */
export type Decision = { ok: true; kinds: CallKind[] } | { ok: false; reason: string };

/** The webhook's view: decode the account's callData, then apply the rules. */
export function decide(callData: Hex | undefined, verified: boolean): Decision {
  const calls = innerCalls(callData);
  if (!calls) return { ok: false, reason: "unreadable" };
  return decideCalls(calls, verified);
}

/** The rules themselves. The app runs the same check before asking, so it
 *  doesn't wait on a sponsorship the webhook is sure to refuse. */
export function decideCalls(calls: InnerCall[], verified: boolean): Decision {
  if (calls.length === 0 || calls.length > MAX_CALLS) return { ok: false, reason: "call_count" };
  const kinds: CallKind[] = [];
  for (const c of calls) {
    const k = classify(c);
    if (!k) return { ok: false, reason: "not_gooddrops" };
    kinds.push(k);
  }
  if (!verified) return { ok: false, reason: "needs_verification" };
  return { ok: true, kinds };
}

/** Accepts 42220, "42220" or "0xa4ec". */
export function isCelo(chainId: unknown): boolean {
  if (typeof chainId === "number") return chainId === 42220;
  if (typeof chainId !== "string") return false;
  const n = chainId.startsWith("0x") ? parseInt(chainId, 16) : Number(chainId);
  return n === 42220;
}
