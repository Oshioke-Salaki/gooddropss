import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { verifyWalletSig } from "@/lib/walletSig";
import { scannerSessionMessage } from "@/lib/taskCreateMsg";
import { endScannerSession, scannerAddress, startScannerSession } from "@/lib/scannerSession";
import { ownsLiveSpot } from "@/lib/spotStore";
import { ownerVerification, OWNER_GATE } from "@/lib/dropGate";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

// The shop owner's reward scanner (lib/scannerSession).
// GET    → { address }  the wallet this phone's scanner is unlocked for, or null
// POST   { address, signature, timestamp } → unlock it for 12 hours
// DELETE → lock it
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ address: null }, { headers: NO_STORE });
  return NextResponse.json({ address: await scannerAddress(redis) }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }

  const address = typeof body.address === "string" ? body.address.toLowerCase() : "";
  const err = await verifyWalletSig(redis, {
    address, signature: body.signature, timestamp: body.timestamp,
    message: (ts) => scannerSessionMessage(address, ts),
  });
  if (err) return NextResponse.json({ error: err }, { status: 401, headers: NO_STORE });

  const [owns, gate] = await Promise.all([ownsLiveSpot(redis, address), ownerVerification(address)]);
  if (!owns) return NextResponse.json({ error: "This wallet doesn't have a live shop yet." }, { status: 403, headers: NO_STORE });
  if (gate !== "verified") return NextResponse.json({ error: OWNER_GATE[gate].error }, { status: OWNER_GATE[gate].status, headers: NO_STORE });

  await startScannerSession(redis, address);
  return NextResponse.json({ address }, { headers: NO_STORE });
}

export async function DELETE() {
  const redis = getRedis();
  if (redis) await endScannerSession(redis);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
