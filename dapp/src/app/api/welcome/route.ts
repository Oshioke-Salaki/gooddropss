import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { REF_ADDR_RE } from "@/lib/referral";
import { clientIp } from "@/lib/eventAuth";
import { overLimit } from "@/lib/referralRateLimit";
import { verifyWalletSig } from "@/lib/walletSig";
import { welcomeMessage } from "@/lib/welcome";
import { welcomeViewFor, hideChest } from "@/lib/welcomeServer";

export const runtime = "nodejs";
// Hiding a chest waits for up to two Celo transactions.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/welcome?address=0x…  → WelcomeView
// This wallet's welcome chest: offered, waiting to be found, opened, or none.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !REF_ADDR_RE.test(address)) return NextResponse.json({ error: "valid address required" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ state: "off" }, { headers: NO_STORE });
  if (await overLimit(redis, "wc-get", clientIp(req.headers), 300, 600))
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  try {
    return NextResponse.json(await welcomeViewFor(redis, address), { headers: NO_STORE });
  } catch {
    // Chain or indexer unreachable: show nothing rather than something wrong.
    return NextResponse.json({ state: "off" }, { headers: NO_STORE });
  }
}

// POST /api/welcome  { address, signature, timestamp, lat, lng, accuracy? }  → WelcomeView
// Hide this person's chest near where they are. Signed, because it spends G$.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    address?: unknown; signature?: unknown; timestamp?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { address, lat, lng, accuracy } = body;
  if (typeof address !== "string" || !REF_ADDR_RE.test(address)) return NextResponse.json({ error: "Sign in first." }, { status: 400 });
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return NextResponse.json({ error: "Turn on your location so we can hide it near you." }, { status: 400 });
  }
  // A fuzzy fix would put the chest somewhere they aren't.
  if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 150) {
    return NextResponse.json({ error: "Your location is still rough. Step outside or wait a few seconds, then try again." }, { status: 400 });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  if (await overLimit(redis, "wc-post", clientIp(req.headers), 20, 600))
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });

  const sigErr = await verifyWalletSig(redis, {
    address, signature: body.signature, timestamp: body.timestamp,
    message: (t) => welcomeMessage(address, t),
  });
  if (sigErr) return NextResponse.json({ error: sigErr }, { status: 401 });

  const r = await hideChest(redis, address, lat, lng);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  return NextResponse.json(r.view, { headers: NO_STORE });
}
