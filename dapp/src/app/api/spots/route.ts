import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { isSpotActive } from "@/lib/spotStatus";
import type { Spot, SpotStatus } from "@/types";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const CATEGORIES = ["food", "retail", "services", "transport", "other"];

// POST /api/spots — register a merchant location that accepts G$.
//   • merchant → status "pending" (awaits admin approval before going live)
//   • admin (session cookie) → status "active" immediately, and may set the owner
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, category, discount, wallet, ownerAddress, lat, lng } = body;

    if (!name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60)
      return NextResponse.json({ error: "Name must be 2–60 characters" }, { status: 400 });
    if (!ownerAddress || !ADDR_RE.test(ownerAddress))
      return NextResponse.json({ error: "Invalid owner address" }, { status: 400 });
    if (!wallet || !ADDR_RE.test(wallet))
      return NextResponse.json({ error: "Invalid payout wallet address" }, { status: 400 });
    if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    if (category && !CATEGORIES.includes(category))
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    const admin = await isAdminAuthed();
    const status: SpotStatus = admin ? "active" : "pending";
    const now = Math.floor(Date.now() / 1000);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const spot: Spot = {
      id,
      name:         name.trim(),
      description:  (description ?? "").trim().slice(0, 280),
      category:     category || "other",
      discount:     (discount ?? "").trim().slice(0, 80),
      wallet:       wallet.toLowerCase(),
      ownerAddress: ownerAddress.toLowerCase(),
      lat, lng,
      createdAt:    now,
      status,
      updatedAt:    now,
    };

    await Promise.all([
      redis.set(keys.spot(id), JSON.stringify(spot)),
      redis.lpush(keys.spotsAll(), id),
      redis.lpush(keys.spotsByOwner(spot.ownerAddress), id),
    ]);

    return NextResponse.json({ spot });
  } catch (e) {
    console.error("[spots/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET /api/spots              → ACTIVE spots only (public map)
// GET /api/spots?owner=0x…    → every spot that owner registered (all statuses)
// GET /api/spots?scope=all    → every spot (admin session only) for moderation
export async function GET(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) return NextResponse.json({ spots: [] });

    const owner = req.nextUrl.searchParams.get("owner");
    const scope = req.nextUrl.searchParams.get("scope");

    if (scope === "all" && !(await isAdminAuthed())) {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    }

    const listKey = owner && ADDR_RE.test(owner) ? keys.spotsByOwner(owner) : keys.spotsAll();
    const ids = await redis.lrange<string>(listKey, 0, 499);
    if (!ids || ids.length === 0) return NextResponse.json({ spots: [] });

    const raw = await redis.mget<(string | Spot | null)[]>(...ids.map((id) => keys.spot(id)));
    let spots: Spot[] = raw
      .filter((s): s is string | Spot => s !== null)
      .map((s) => (typeof s === "string" ? (JSON.parse(s) as Spot) : s));

    // Public map (no owner, not admin-all) shows only live spots.
    if (!owner && scope !== "all") spots = spots.filter(isSpotActive);

    return NextResponse.json({ spots });
  } catch (e) {
    console.error("[spots/get]", e);
    return NextResponse.json({ spots: [] });
  }
}
