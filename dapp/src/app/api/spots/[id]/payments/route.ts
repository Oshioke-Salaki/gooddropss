import { NextRequest, NextResponse } from "next/server";
import type { Redis } from "@upstash/redis";
import type { Hex } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { publicClient } from "@/lib/publicClient";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";
import { getSpot } from "@/lib/spotStore";
import { milliToWei, sumTokenTransfersTo, weiToMilli } from "@/lib/spotPayments";
import type { SpotPayment } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const LIST_CAP = 500;

// POST /api/spots/[id]/payments  Body: { tx }
// Records a G$ payment made at this shop, for the merchant's dashboard. Nothing
// in the body is trusted except the tx hash: payer, amount and time are read
// from the chain, the transfer must pay THIS shop's wallet in G$, and each
// transaction is recorded once.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const tx = typeof body.tx === "string" ? body.tx.toLowerCase() : "";
    if (!TX_RE.test(tx)) return NextResponse.json({ error: "Invalid tx hash" }, { status: 400 });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    const spot = await getSpot(redis, id);
    if (!spot) return NextResponse.json({ error: "Spot not found" }, { status: 404 });
    if (await redis.get(keys.spotPayTx(tx))) return NextResponse.json({ ok: true, duplicate: true });

    // The client posts right after its receipt; a load-balanced RPC node can lag
    // a few seconds behind, so retry briefly before calling it missing.
    let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null;
    for (let attempt = 0; attempt < 6 && !receipt; attempt++) {
      try { receipt = await publicClient.getTransactionReceipt({ hash: tx as Hex }); }
      catch { if (attempt < 5) await new Promise((r) => setTimeout(r, 1500)); }
    }
    if (!receipt) return NextResponse.json({ error: "Transaction not found yet" }, { status: 404 });
    if (receipt.status !== "success") return NextResponse.json({ error: "Transaction failed" }, { status: 422 });

    const paid = sumTokenTransfersTo(receipt.logs, G_TOKEN_ADDRESS, spot.wallet);
    if (!paid) return NextResponse.json({ error: "Not a G$ payment to this shop" }, { status: 422 });

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const ts = Number(block.timestamp);
    // Only payments made while the shop existed count (not old transfers to the same wallet).
    if (ts < (spot.createdAt ?? 0) - 300) return NextResponse.json({ error: "Payment predates this shop" }, { status: 422 });

    // Claim the tx once, across every shop, then write.
    const fresh = await redis.set(keys.spotPayTx(tx), id, { nx: true });
    if (fresh === null) return NextResponse.json({ ok: true, duplicate: true });

    const payment: SpotPayment = { payer: paid.payer, amount: paid.amount.toString(), tx, ts, verified: true };
    try {
      await ensurePayStats(redis, id);
      const p = redis.pipeline();
      p.lpush(keys.spotPayments(id), JSON.stringify(payment));
      p.ltrim(keys.spotPayments(id), 0, LIST_CAP - 1);
      p.hincrby(keys.spotPayStats(id), "count", 1);
      p.hincrby(keys.spotPayStats(id), "milli", weiToMilli(paid.amount));
      await p.exec();
    } catch (e) {
      await redis.del(keys.spotPayTx(tx)).catch(() => {});   // let a retry record it
      throw e;
    }
    return NextResponse.json({ ok: true, payment });
  } catch (e) {
    console.error("[spots/payments/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET /api/spots/[id]/payments — recent payments + all-time totals for the merchant
// dashboard. Everything here is already public on-chain (transfers to the shop's
// wallet); totals come from running counters, so they never cap out.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const redis = getRedis();
    if (!redis) return NextResponse.json({ payments: [], count: 0, totalWei: "0" });
    // Never create counters for ids that aren't shops.
    if (id.length > 64 || !(await redis.exists(keys.spot(id)))) {
      return NextResponse.json({ payments: [], count: 0, totalWei: "0" });
    }

    await ensurePayStats(redis, id);
    const [raw, stats] = await Promise.all([
      redis.lrange<string | SpotPayment>(keys.spotPayments(id), 0, 49),
      redis.hgetall<Record<string, string | number>>(keys.spotPayStats(id)),
    ]);
    const payments: SpotPayment[] = (raw ?? []).map((p) => (typeof p === "string" ? (JSON.parse(p) as SpotPayment) : p));
    return NextResponse.json(
      { payments, count: Number(stats?.count ?? 0), totalWei: milliToWei(stats?.milli ?? 0).toString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[spots/payments/get]", e);
    return NextResponse.json({ payments: [], count: 0, totalWei: "0" });
  }
}

/**
 * Running totals didn't exist before; seed them once from the payments already
 * listed for this shop, so existing merchants keep their history.
 */
async function ensurePayStats(redis: Redis, id: string): Promise<void> {
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
