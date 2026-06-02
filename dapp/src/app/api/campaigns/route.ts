import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import type { Campaign } from "@/types";

export const runtime = "nodejs";

const NAME_RE = /^.{2,60}$/;
const HEX_RE  = /^#[0-9a-fA-F]{6}$/;

// POST /api/campaigns — create a new campaign
export async function POST(req: NextRequest) {
  try {
    const { name, description, color, logo, ownerAddress, goodcollectivePool } = await req.json();

    if (!name || !NAME_RE.test(name.trim()))
      return NextResponse.json({ error: "Name must be 2–60 characters" }, { status: 400 });
    if (!ownerAddress || !/^0x[0-9a-fA-F]{40}$/.test(ownerAddress))
      return NextResponse.json({ error: "Invalid owner address" }, { status: 400 });
    if (color && !HEX_RE.test(color))
      return NextResponse.json({ error: "Invalid color" }, { status: 400 });
    if (goodcollectivePool && !/^0x[0-9a-fA-F]{40}$/.test(goodcollectivePool))
      return NextResponse.json({ error: "Invalid GoodCollective pool address" }, { status: 400 });

    const redis = getRedis();
    if (!redis)
      return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const campaign: Campaign = {
      id,
      name:         name.trim(),
      description:  (description ?? "").trim().slice(0, 280),
      color:               color || "#BFFD00",
      logo:                logo?.trim() || undefined,
      ownerAddress:        ownerAddress.toLowerCase(),
      createdAt:           Math.floor(Date.now() / 1000),
      goodcollectivePool:  goodcollectivePool?.toLowerCase() || undefined,
    };

    await Promise.all([
      redis.set(keys.campaign(id), JSON.stringify(campaign), { ex: 60 * 60 * 24 * 365 }),
      redis.lpush(keys.campaignsByOwner(ownerAddress), id),
    ]);

    return NextResponse.json({ campaign });
  } catch (e) {
    console.error("[campaigns/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET /api/campaigns?owner=0x... — list campaigns for an owner
export async function GET(req: NextRequest) {
  try {
    const owner = req.nextUrl.searchParams.get("owner");
    if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner))
      return NextResponse.json({ campaigns: [] });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ campaigns: [] });

    const ids = await redis.lrange<string>(keys.campaignsByOwner(owner), 0, 49);
    if (!ids.length) return NextResponse.json({ campaigns: [] });

    const raws = await Promise.all(ids.map((id) => redis.get<string>(keys.campaign(id))));
    const campaigns: Campaign[] = raws
      .map((r) => {
        try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; }
      })
      .filter(Boolean) as Campaign[];

    return NextResponse.json({ campaigns });
  } catch (e) {
    console.error("[campaigns/get]", e);
    return NextResponse.json({ campaigns: [] });
  }
}
