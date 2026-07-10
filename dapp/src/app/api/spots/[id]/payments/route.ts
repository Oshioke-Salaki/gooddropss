import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import type { SpotPayment } from "@/types";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE   = /^0x[0-9a-fA-F]{64}$/;

// POST /api/spots/[id]/payments — record a G$ payment made at this spot.
// Fire-and-forget from the client after the on-chain transfer confirms; used
// for merchant analytics ("N verified humans paid here this week").
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { payer, amount, tx } = await req.json();

    if (!payer || !ADDR_RE.test(payer))
      return NextResponse.json({ error: "Invalid payer" }, { status: 400 });
    if (!tx || !TX_RE.test(tx))
      return NextResponse.json({ error: "Invalid tx hash" }, { status: 400 });
    if (typeof amount !== "string" || !/^\d+$/.test(amount))
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    // Spot must exist
    const spot = await redis.get(keys.spot(id));
    if (!spot) return NextResponse.json({ error: "Spot not found" }, { status: 404 });

    const payment: SpotPayment = {
      payer: payer.toLowerCase(),
      amount,
      tx,
      ts: Math.floor(Date.now() / 1000),
    };
    await redis.lpush(keys.spotPayments(id), JSON.stringify(payment));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[spots/payments/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET /api/spots/[id]/payments — payment history + totals for the merchant dashboard
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const redis = getRedis();
    if (!redis) return NextResponse.json({ payments: [], count: 0, totalWei: "0" });

    const raw = await redis.lrange<string | SpotPayment>(keys.spotPayments(id), 0, 199);
    const payments: SpotPayment[] = (raw ?? []).map((p) =>
      typeof p === "string" ? (JSON.parse(p) as SpotPayment) : p,
    );

    const totalWei = payments.reduce((s, p) => s + BigInt(p.amount), 0n).toString();

    return NextResponse.json({ payments, count: payments.length, totalWei });
  } catch (e) {
    console.error("[spots/payments/get]", e);
    return NextResponse.json({ payments: [], count: 0, totalWei: "0" });
  }
}
