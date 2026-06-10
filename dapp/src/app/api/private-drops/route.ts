import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

// 30-day TTL — private drop coords expire with the maximum drop lifetime
const TTL_SECONDS = 60 * 60 * 24 * 30;

interface PrivateDropRecord {
  lat: number;
  lng: number;
  dropId?: string;
}

// POST /api/private-drops
// Body: { lat: number, lng: number }
// Returns: { token: string }
// Called BEFORE the on-chain createDrop so the token is ready for the share URL.
export async function POST(req: NextRequest) {
  try {
    const { lat, lng } = await req.json();
    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
    }

    const token = randomBytes(16).toString("hex");
    await redis.set(keys.privateDrop(token), { lat, lng } satisfies PrivateDropRecord, {
      ex: TTL_SECONDS,
    });

    return NextResponse.json({ token });
  } catch (e) {
    console.error("[private-drops POST]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PATCH /api/private-drops
// Body: { token: string, dropId: string }
// Stamps the on-chain dropId onto the record once the transaction confirms.
export async function PATCH(req: NextRequest) {
  try {
    const { token, dropId } = await req.json();
    if (!token || !dropId) {
      return NextResponse.json({ error: "token and dropId required" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) return NextResponse.json({ ok: true });

    const existing = await redis.get<PrivateDropRecord>(keys.privateDrop(token));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await redis.set(keys.privateDrop(token), { ...existing, dropId }, { ex: TTL_SECONDS });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[private-drops PATCH]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET /api/private-drops?token=TOKEN
// Returns: { lat: number, lng: number } for authorized viewers.
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    const record = await redis.get<PrivateDropRecord>(keys.privateDrop(token));
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ lat: record.lat, lng: record.lng });
  } catch (e) {
    console.error("[private-drops GET]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
