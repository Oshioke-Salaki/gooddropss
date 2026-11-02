import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifyWalletSig } from "@/lib/walletSig";
import { endSession, sessionAddress, startSession } from "@/lib/walletSession";
import { walletSessionMessage } from "@/lib/walletSessionMsg";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/session → { address } — the wallet this browser has a session for (or null).
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ address: null }, { headers: NO_STORE });
  return NextResponse.json({ address: await sessionAddress(redis) }, { headers: NO_STORE });
}

// POST /api/session  Body: { address, signature, timestamp } → start a session.
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }

  const address = typeof body.address === "string" ? body.address.toLowerCase() : "";
  const err = await verifyWalletSig(redis, {
    address, signature: body.signature, timestamp: body.timestamp,
    message: (ts) => walletSessionMessage(address, ts),
  });
  if (err) return NextResponse.json({ error: err }, { status: 401 });

  await startSession(redis, address);
  return NextResponse.json({ address }, { headers: NO_STORE });
}

// DELETE /api/session → sign out of the session (on wallet sign-out).
export async function DELETE() {
  const redis = getRedis();
  if (redis) await endSession(redis);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
