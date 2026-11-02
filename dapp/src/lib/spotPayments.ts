import { decodeEventLog, parseAbi, type Hex } from "viem";

// Pure helpers for verifying a G$ payment to a shop from its on-chain receipt.
// Kept free of server imports so they can be unit-tested directly.

const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export interface ReceiptLog { address: string; topics: readonly Hex[] | Hex[]; data: Hex }

/**
 * Sum the G$ Transfer events in a receipt that pay `to`. Returns the payer (the
 * `from` of those transfers) and the total, or null when nothing in the receipt
 * pays this wallet in G$. Transfers from more than one sender are rejected:
 * a shop payment comes from one customer.
 */
export function sumTokenTransfersTo(
  logs: readonly ReceiptLog[], token: string, to: string,
): { payer: string; amount: bigint } | null {
  const tokenLc = token.toLowerCase();
  const toLc = to.toLowerCase();
  let payer: string | null = null;
  let amount = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== tokenLc) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    } catch { continue; }
    if (decoded.eventName !== "Transfer") continue;
    const { from, to: dest, value } = decoded.args;
    if (dest.toLowerCase() !== toLc || value <= 0n) continue;
    if (payer && payer !== from.toLowerCase()) return null;
    payer = from.toLowerCase();
    amount += value;
  }
  return payer && amount > 0n ? { payer, amount } : null;
}

const MILLI = 10n ** 15n; // wei per 0.001 G$

/** Wei → whole thousandths of a G$ (what the running totals store; fits a Redis integer). */
export function weiToMilli(wei: bigint): number {
  return Number(wei / MILLI);
}

export function milliToWei(milli: number | string): bigint {
  const n = typeof milli === "string" ? Number(milli) : milli;
  return Number.isFinite(n) && n > 0 ? BigInt(Math.floor(n)) * MILLI : 0n;
}
