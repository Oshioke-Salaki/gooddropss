import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { publicClient } from "@/lib/publicClient";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";
import { getSpot } from "@/lib/spotStore";
import { milliToWei, sumTokenTransfersTo } from "@/lib/spotPayments";
import { ensurePayStats, isPersonPayer, isSelfTransfer, recordPayment, syncSpotPayments } from "@/lib/spotPaymentStore";
import type { SpotPayment } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

// POST /api/spots/[id]/payments  Body: { tx }
// Records a G$ payment made at this shop, for the merchant's dashboard. Nothing
// in the body is trusted except the tx hash: payer, amount and time are read
// from the chain, the transfer must pay THIS shop's wallet in G$ from a person,
// and each transaction is recorded once.
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
    if (isSelfTransfer(spot, paid.payer) || !(await isPersonPayer(paid.payer))) {
      return NextResponse.json({ error: "Not a customer payment" }, { status: 422 });
    }

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const ts = Number(block.timestamp);
    // Only payments made while the shop existed count (not old transfers to the same wallet).
    if (ts < (spot.createdAt ?? 0) - 300) return NextResponse.json({ error: "Payment predates this shop" }, { status: 422 });

    const payment: SpotPayment = { payer: paid.payer, amount: paid.amount.toString(), tx, ts, verified: true };
    const fresh = await recordPayment(redis, id, payment);
    return NextResponse.json(fresh ? { ok: true, payment } : { ok: true, duplicate: true });
  } catch (e) {
    console.error("[spots/payments/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET /api/spots/[id]/payments[?sync=1] — recent payments + all-time totals for
// the merchant dashboard. `sync=1` (the till) first pulls new transfers into the
// shop's wallet from the chain. Everything here is already public on-chain;
// totals come from running counters, so they never cap out.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const redis = getRedis();
    // An outage must never look like "no payments": the till would take the
    // next good answer as a day's worth of new ones.
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    // Never create counters for ids that aren't shops.
    const spot = id.length <= 64 ? await getSpot(redis, id) : null;
    if (!spot) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

    if (req.nextUrl.searchParams.get("sync") === "1") {
      await syncSpotPayments(redis, spot).catch((e) => console.error("[spots/payments/sync]", e));
    }

    await ensurePayStats(redis, id);
    const [raw, stats] = await Promise.all([
      redis.lrange<string | SpotPayment>(keys.spotPayments(id), 0, 49),
      redis.hgetall<Record<string, string | number>>(keys.spotPayStats(id)),
    ]);
    const payments: SpotPayment[] = (raw ?? []).map((p) => (typeof p === "string" ? (JSON.parse(p) as SpotPayment) : p));
    return NextResponse.json(
      { payments, count: Number(stats?.count ?? 0), totalWei: milliToWei(stats?.milli ?? 0).toString(), at: Date.now() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[spots/payments/get]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
