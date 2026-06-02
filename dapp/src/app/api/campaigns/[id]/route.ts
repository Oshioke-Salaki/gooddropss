import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import type { Campaign } from "@/types";

export const runtime = "nodejs";

// GET /api/campaigns/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    const raw = await redis.get<string>(keys.campaign(id));
    if (!raw) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const campaign: Campaign = typeof raw === "string" ? JSON.parse(raw) : raw;

    const claims = await redis.get<string>(keys.campaignClaims(id));

    return NextResponse.json({ campaign, claims: Number(claims ?? 0) });
  } catch (e) {
    console.error("[campaigns/get-by-id]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
