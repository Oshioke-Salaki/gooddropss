import type { Redis } from "@upstash/redis";
import { parseAbiItem, type Hex } from "viem";
import { keys } from "@/lib/redis";
import { publicClient } from "@/lib/publicClient";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";
import { weiToMilli } from "@/lib/spotPayments";
import type { Spot, SpotPayment } from "@/types";

// Server-only. Records verified G$ payments to a shop, from two sources that
// may race: the customer's app reporting its own payment, and the till reading
// the chain directly. Both go through recordPayment, which counts a tx once.

const LIST_CAP = 500;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/**
 * A payment comes from a person, not a contract. Shops are often paid into the
 * owner's own wallet, which also receives their UBI, drop claims and faucet
 * top-ups; those come from contracts and must not show up as sales. Wallets
 * upgraded with EIP-7702 (Magic sign-ins) carry a delegation marker as code but
 * are still people.
 */
export async function isPersonPayer(address: string): Promise<boolean> {
  try {
    const code = await publicClient.getCode({ address: address as Hex });
    return !code || code === "0x" || code.toLowerCase().startsWith("0xef0100");
  } catch { return true; }
}

/** A transfer the shop's own wallets made to themselves isn't a sale either. */
export function isSelfTransfer(spot: Spot, payer: string): boolean {
  const p = payer.toLowerCase();
  return p === spot.wallet?.toLowerCase() || p === spot.ownerAddress?.toLowerCase();
}

/** Record once. Returns false when this tx was already counted (for any shop). */
export async function recordPayment(redis: Redis, spotId: string, payment: SpotPayment): Promise<boolean> {
  const fresh = await redis.set(keys.spotPayTx(payment.tx), spotId, { nx: true });
  if (fresh === null) return false;
  try {
    await ensurePayStats(redis, spotId);
    const p = redis.pipeline();
    p.lpush(keys.spotPayments(spotId), JSON.stringify(payment));
    p.ltrim(keys.spotPayments(spotId), 0, LIST_CAP - 1);
    p.hincrby(keys.spotPayStats(spotId), "count", 1);
    p.hincrby(keys.spotPayStats(spotId), "milli", weiToMilli(BigInt(payment.amount)));
    await p.exec();
    return true;
  } catch (e) {
    await redis.del(keys.spotPayTx(payment.tx)).catch(() => {});   // let a retry record it
    throw e;
  }
}

/**
 * Running totals didn't exist before; seed them once from the payments already
 * listed for this shop, so existing merchants keep their history.
 */
export async function ensurePayStats(redis: Redis, id: string): Promise<void> {
  const claimed = await redis.hsetnx(keys.spotPayStats(id), "seeded", 1);
  if (claimed !== 1) return;
  const raw = (await redis.lrange<string | SpotPayment>(keys.spotPayments(id), 0, -1)) ?? [];
  let count = 0;
  let milli = 0;
  for (const r of raw) {
    try {
      const p = typeof r === "string" ? (JSON.parse(r) as SpotPayment) : r;
      milli += weiToMilli(BigInt(p.amount));
      count += 1;
    } catch { /* skip a malformed legacy row */ }
  }
  if (count > 0) {
    const p = redis.pipeline();
    p.hincrby(keys.spotPayStats(id), "count", count);
    p.hincrby(keys.spotPayStats(id), "milli", milli);
    await p.exec();
  }
}

// Celo makes a block about every second; look back at most this far on a sync.
const MAX_LOOKBACK = 1_800n;

/**
 * Pull G$ transfers into the shop's wallet straight from the chain, so the till
 * shows a payment even if the customer closed their app before it reported it.
 * Throttled per shop; safe to call on every till poll.
 */
export async function syncSpotPayments(redis: Redis, spot: Spot): Promise<number> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(spot.wallet ?? "")) return 0;
  const go = await redis.set(keys.spotPaySync(spot.id), "1", { nx: true, ex: 3 });
  if (go === null) return 0;

  // Stay a few blocks behind the tip: behind a load balancer, the node answering
  // getLogs can be a block or two behind the one that reported the height, and
  // asks past its head fail with "block is out of range".
  const latest = (await publicClient.getBlockNumber()) - 3n;
  const last = await redis.get<string | number>(keys.spotPaySyncBlock(spot.id));
  const lastN = last !== null && last !== undefined ? BigInt(last) : null;
  const from = lastN !== null && lastN + 1n > latest - MAX_LOOKBACK ? lastN + 1n : latest - MAX_LOOKBACK;
  if (from > latest) return 0;

  let logs;
  try {
    logs = await publicClient.getLogs({
      address: G_TOKEN_ADDRESS, event: TRANSFER, args: { to: spot.wallet as Hex }, fromBlock: from, toBlock: latest,
    });
  } catch {
    return 0;   // try again on the next poll; the sync point hasn't moved
  }

  // One payment per tx (a tx may hold several transfers from the same payer).
  const byTx = new Map<string, { payer: string; amount: bigint; block: bigint }>();
  for (const l of logs) {
    const tx = l.transactionHash?.toLowerCase();
    const payer = l.args.from?.toLowerCase();
    const value = l.args.value ?? 0n;
    if (!tx || !payer || value <= 0n || l.blockNumber === null) continue;
    const cur = byTx.get(tx);
    if (cur && cur.payer !== payer) { byTx.delete(tx); continue; }
    byTx.set(tx, { payer, amount: (cur?.amount ?? 0n) + value, block: l.blockNumber });
  }

  let added = 0;
  const blockTimes = new Map<bigint, number>();
  for (const [tx, t] of byTx) {
    if (await redis.get(keys.spotPayTx(tx))) continue;
    if (isSelfTransfer(spot, t.payer) || !(await isPersonPayer(t.payer))) continue;
    if (!blockTimes.has(t.block)) {
      const b = await publicClient.getBlock({ blockNumber: t.block });
      blockTimes.set(t.block, Number(b.timestamp));
    }
    const ts = blockTimes.get(t.block)!;
    if (ts < (spot.createdAt ?? 0) - 300) continue;
    if (await recordPayment(redis, spot.id, { payer: t.payer, amount: t.amount.toString(), tx, ts, verified: true })) added++;
  }
  await redis.set(keys.spotPaySyncBlock(spot.id), latest.toString());
  return added;
}
