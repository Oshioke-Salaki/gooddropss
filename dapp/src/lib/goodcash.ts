// Cash out: G$ to a Nigerian bank account, through GoodCash (pay.goodcash.xyz).
//
// The user's wallet signs ONE transaction: G$.transferAndCall(router, amount,
// data). GoodCash's router (verified, not upgradeable, owner can only pause)
// swaps the G$ to dollars, pays the bank partner (Paycrest) exactly what the
// order needs and sends any surplus straight back to the user. Nothing is
// approved for later, so nothing else in the wallet is ever exposed.
//
// GoodCash's server decides the order details, so before any wallet is asked
// to sign we check the transaction ourselves (checkCashOutTx below): right
// token, right router, exactly the amount the person typed, no CELO, an order
// that is still open. We never load GoodCash's widget script: it would run
// their code on our page and sign whatever it asked.
//
// Shared by the browser and the server. No secrets in here.

import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";

/** GoodCashRouterV2 on Celo. Fixed here on purpose: never taken from the API. */
export const GOODCASH_ROUTER = "0x546698368a246539Df5e641EdC2b79c5782ea359" as const;
export const CELO_CHAIN_ID = 42220;

/** The most one withdrawal may take (there's no daily limit). */
export const MAX_WITHDRAW_G = 200_000;

export const TRANSFER_AND_CALL_ABI = parseAbi([
  "function transferAndCall(address to, uint256 value, bytes data) returns (bool)",
]);

/** abi.encode(uint8 route, uint256 minOut, uint256 deadline, address payTo, uint256 payAmount, bytes32 ref) */
const ORDER_PARAMS = [
  { type: "uint8", name: "route" },
  { type: "uint256", name: "minOut" },
  { type: "uint256", name: "deadline" },
  { type: "address", name: "payTo" },
  { type: "uint256", name: "payAmount" },
  { type: "bytes32", name: "ref" },
] as const;

export interface CashOutTx { chainId: number; to: string; data: string; value: string }
export interface CashOutOrder {
  router: string;
  payTo: string;
  payAmount: string;
  amountWei: string;
  minOut: string;
  validUntil: string;
}

/** What the wallet will actually be asked to send, once checked. */
export interface CheckedCall {
  amountWei: bigint;
  data: Hex;
}

export type CheckResult = { ok: true; call: CheckedCall } | { ok: false; reason: string };

/**
 * The check before any wallet signs. Returns the exact call to send, rebuilt
 * from the decoded values, so what we sign is byte for byte what we checked.
 *
 * `amountWei` is what the PERSON asked for, computed on our side, never the
 * API's figure. Test-mode orders carry a 1970 deadline on purpose; pass
 * `testMode` to skip only the time checks.
 */
export function checkCashOutTx(
  tx: CashOutTx,
  order: CashOutOrder,
  amountWei: bigint,
  opts: { testMode?: boolean; nowMs?: number } = {},
): CheckResult {
  const now = opts.nowMs ?? Date.now();
  try {
    if (tx.chainId !== CELO_CHAIN_ID) return { ok: false, reason: "wrong_chain" };
    if (tx.to.toLowerCase() !== G_TOKEN_ADDRESS.toLowerCase()) return { ok: false, reason: "wrong_token" };
    if (BigInt(tx.value || "0x0") !== 0n) return { ok: false, reason: "sends_celo" };
    if (order.router.toLowerCase() !== GOODCASH_ROUTER.toLowerCase()) return { ok: false, reason: "wrong_router" };

    const outer = decodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, data: tx.data as Hex });
    if (outer.functionName !== "transferAndCall") return { ok: false, reason: "wrong_function" };
    const [to, value, inner] = outer.args;
    if (to.toLowerCase() !== GOODCASH_ROUTER.toLowerCase()) return { ok: false, reason: "wrong_router" };
    if (value !== amountWei || BigInt(order.amountWei) !== amountWei) return { ok: false, reason: "wrong_amount" };

    const [route, minOut, deadline, payTo, payAmount] = decodeAbiParameters(ORDER_PARAMS, inner);
    if (route !== 0 && route !== 1) return { ok: false, reason: "unknown_route" };
    if (payTo.toLowerCase() !== order.payTo.toLowerCase()) return { ok: false, reason: "wrong_pay_to" };
    if (payAmount !== BigInt(order.payAmount)) return { ok: false, reason: "wrong_pay_amount" };
    if (payAmount <= 0n || payAmount > minOut) return { ok: false, reason: "bad_minimum" };
    if (BigInt(order.minOut) !== minOut) return { ok: false, reason: "bad_minimum" };
    if (!opts.testMode) {
      const deadlineMs = Number(deadline) * 1000;
      const closesMs = Date.parse(order.validUntil);
      if (!(deadlineMs > now)) return { ok: false, reason: "expired" };
      if (Number.isFinite(closesMs) && deadlineMs > closesMs + 1000) return { ok: false, reason: "deadline_after_order" };
    }

    // Rebuild and compare: no trailing bytes, nothing we didn't read.
    const rebuilt = encodeFunctionData({ abi: TRANSFER_AND_CALL_ABI, functionName: "transferAndCall", args: [to, value, inner] });
    if (rebuilt.toLowerCase() !== tx.data.toLowerCase()) return { ok: false, reason: "extra_data" };
    return { ok: true, call: { amountWei: value, data: inner } };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Exposed for tests: builds the inner order data the router decodes. */
export function encodeOrderData(o: { route: number; minOut: bigint; deadline: bigint; payTo: Hex; payAmount: bigint; ref: Hex }): Hex {
  return encodeAbiParameters(ORDER_PARAMS, [o.route, o.minOut, o.deadline, o.payTo, o.payAmount, o.ref]);
}

// ── Shapes our API returns to the app ─────────────────────────────────────────

export type CashOutStatus = "awaiting_signature" | "sent" | "processing" | "paid" | "failed" | "refunded" | "expired";

export interface FeeLine { type: string; label: string; percent?: number; amountG?: string; naira?: number }

export interface Quote {
  amountG: string;
  receive: { naira: number; minimumNaira: number };
  feePercent: number;
  fees: FeeLine[];
  minimumG: number;
  enough: boolean;
  nairaPerDollar: number;
  expiresAt: string;
}

export interface Bank { code: string; name: string; popular?: boolean }

export interface CashOutView {
  id: string;
  status: CashOutStatus;
  amountG: string;
  naira: number;
  txHash: string | null;
  createdAt: string;
  paidAt: string | null;
  accountName?: string;
  bankName?: string;
  accountLast4?: string;
}

export const isFinal = (s: CashOutStatus) => s === "paid" || s === "failed" || s === "refunded" || s === "expired";

/** "4,990" style naira, whole naira (no kobo). */
export const formatNaira = (n: number) =>
  `₦${Math.floor(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

export const CASH_OUT_PAID_EVENT = parseAbi([
  "event CashOutPaid(address indexed user, address indexed payTo, uint256 gIn, uint256 usdtOut, uint256 usdtPaid, uint256 usdtReturned, uint8 route, bytes32 ref)",
])[0];

// ── GoodDrops' own 1% ─────────────────────────────────────────────────────────
// Taken in G$ in the same transaction as the cash out and sent straight to the
// GoodDrops wallet (not through GoodCash, whose partner fee is set to 0%).

export const GOODDROPS_FEE_WALLET = "0xB2914810724FE2Fb871960eB200Dea427854b1C7" as const;
export const GOODDROPS_FEE_PERCENT = 1;

/**
 * Split what the person cashes out into our fee and the part GoodCash turns
 * into naira. Works in whole cents of G$ so both halves stay short decimals.
 */
export function splitAmount(totalG: string): { cashG: string; feeG: string } {
  const cents = BigInt(Math.round(Number(totalG) * 100));
  const feeCents = (cents * BigInt(GOODDROPS_FEE_PERCENT)) / 100n;
  const cashCents = cents - feeCents;
  const fmt = (c: bigint) => {
    const whole = c / 100n, frac = c % 100n;
    return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
  };
  return { cashG: fmt(cashCents), feeG: fmt(feeCents) };
}
