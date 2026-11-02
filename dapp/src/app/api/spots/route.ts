import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { clientIp } from "@/lib/eventAuth";
import { verifyWalletSig } from "@/lib/walletSig";
import { sessionAddress, startSessionQuietly } from "@/lib/walletSession";
import { normalizeSpotDraft, spotDigest, spotMessage, SPOT_CATEGORIES } from "@/lib/spotAuth";
import { isSpotActive, spotStatus, SPOT_STATUSES } from "@/lib/spotStatus";
import {
  countSpots, getSpot, getSpots, listSpots, publicSpot, saveSpot, unavailableSpot,
} from "@/lib/spotStore";
import type { Spot, SpotStatus } from "@/types";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const NO_STORE = { "Cache-Control": "private, no-store" };

// Abuse limits for merchant sign-ups (admins are exempt).
const LIMITS = {
  perIpPerDay: 10,        // registration attempts from one network per day
  pendingPerOwner: 3,     // shops one wallet can have waiting for review
  shopsPerOwner: 10,      // shops one wallet can own in total
  pendingGlobal: 300,     // review queue ceiling, so a flood can't bury the console
};

// POST /api/spots — register a merchant location that accepts G$.
//   • merchant → signed by the owner wallet; status "pending" until an admin approves
//   • admin (session cookie) → status "active" immediately, and may set the owner
export async function POST(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }

    const draft = normalizeSpotDraft(body);
    const ownerAddress = typeof body.ownerAddress === "string" ? body.ownerAddress.trim().toLowerCase() : "";

    if (draft.name.length < 2 || String(body.name ?? "").trim().length > 60)
      return NextResponse.json({ error: "Name must be 2–60 characters" }, { status: 400 });
    if (!ADDR_RE.test(ownerAddress))
      return NextResponse.json({ error: "Invalid owner address" }, { status: 400 });
    if (!ADDR_RE.test(draft.wallet))
      return NextResponse.json({ error: "Invalid payout wallet address" }, { status: 400 });
    if (typeof body.lat !== "number" || typeof body.lng !== "number" || !Number.isFinite(draft.lat) || !Number.isFinite(draft.lng)
      || Math.abs(draft.lat) > 90 || Math.abs(draft.lng) > 180)
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    if (!(SPOT_CATEGORIES as readonly string[]).includes(draft.category))
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });

    const admin = await isAdminAuthed();

    if (!admin) {
      // Cheapest check first, before the signature costs an RPC call.
      const rlKey = keys.spotRegisterRl(clientIp(req.headers));
      const attempts = await redis.incr(rlKey);
      if (attempts === 1) await redis.expire(rlKey, 86_400);
      if (attempts > LIMITS.perIpPerDay) {
        return NextResponse.json({ error: "Too many sign-ups from this network today. Try again tomorrow." }, { status: 429 });
      }

      const sigErr = await verifyWalletSig(redis, {
        address: ownerAddress, signature: body.signature, timestamp: body.timestamp,
        message: (ts) => spotMessage("register", "new", ts, spotDigest(draft)),
      });
      if (sigErr) return NextResponse.json({ error: sigErr }, { status: 401 });

      const ownerIds = (await redis.lrange<string>(keys.spotsByOwner(ownerAddress), 0, 199)) ?? [];
      const owned = await getSpots(redis, [...new Set(ownerIds)]);
      if (owned.length >= LIMITS.shopsPerOwner) {
        return NextResponse.json({ error: `One wallet can register up to ${LIMITS.shopsPerOwner} shops.` }, { status: 429 });
      }
      if (owned.filter((s) => spotStatus(s) === "pending").length >= LIMITS.pendingPerOwner) {
        return NextResponse.json({ error: "You already have shops waiting for review. We'll get to them soon." }, { status: 429 });
      }
      if ((await countSpots(redis, "pending")) >= LIMITS.pendingGlobal) {
        return NextResponse.json({ error: "We're reviewing a lot of shops right now. Please try again later." }, { status: 503 });
      }
    }

    const status: SpotStatus = admin ? "active" : "pending";
    const now = Math.floor(Date.now() / 1000);
    const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

    const spot: Spot = {
      id,
      name:         draft.name,
      description:  draft.description,
      category:     draft.category,
      discount:     draft.discount,
      wallet:       draft.wallet,
      ownerAddress,
      lat: draft.lat, lng: draft.lng,
      ...(draft.placeName ? { placeName: draft.placeName } : {}),
      createdAt:    now,
      status,
      updatedAt:    now,
    };

    await saveSpot(redis, spot);
    await Promise.all([
      redis.lpush(keys.spotsAll(), id),
      redis.lpush(keys.spotsByOwner(ownerAddress), id),
    ]);
    // The signature just proved the wallet: let this browser see its own pending shop.
    if (!admin) await startSessionQuietly(redis, ownerAddress);

    return NextResponse.json({ spot }, { headers: NO_STORE });
  } catch (e) {
    console.error("[spots/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET /api/spots              → live shops only (public map, CDN-cached)
// GET /api/spots?id=…         → one shop. Live: public view. Not live: only enough to
//                               say so, unless the caller is its owner (session) or an admin.
// GET /api/spots?owner=0x…    → that wallet's shops. Every status for the owner's own
//                               session or an admin; otherwise live shops only.
// GET /api/spots?scope=all    → every shop (admin session only) for moderation
export async function GET(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) return NextResponse.json({ spots: [] });

    const idParam = req.nextUrl.searchParams.get("id");
    if (idParam) {
      const spot = await getSpot(redis, idParam);
      if (!spot) return NextResponse.json({ spot: null }, { headers: NO_STORE });
      if (isSpotActive(spot)) return NextResponse.json({ spot: publicSpot(spot) }, { headers: NO_STORE });
      const viewer = await sessionAddress(redis);
      const privileged = viewer === spot.ownerAddress?.toLowerCase() || (await isAdminAuthed());
      return NextResponse.json({ spot: privileged ? spot : unavailableSpot(spot) }, { headers: NO_STORE });
    }

    const owner = req.nextUrl.searchParams.get("owner")?.toLowerCase();
    if (owner) {
      if (!ADDR_RE.test(owner)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
      const ids = (await redis.lrange<string>(keys.spotsByOwner(owner), 0, 199)) ?? [];
      const spots = await getSpots(redis, [...new Set(ids)]);
      const verified = (await sessionAddress(redis)) === owner || (await isAdminAuthed());
      if (verified) return NextResponse.json({ spots, verified: true, hidden: 0 }, { headers: NO_STORE });
      const live = spots.filter(isSpotActive);
      return NextResponse.json(
        { spots: live.map(publicSpot), verified: false, hidden: spots.length - live.length },
        { headers: NO_STORE },
      );
    }

    if (req.nextUrl.searchParams.get("scope") === "all") {
      if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
      return NextResponse.json({ spots: await listSpots(redis, SPOT_STATUSES) }, { headers: NO_STORE });
    }

    // The public shop list changes slowly, so it's CDN-cached: every map visit
    // shouldn't invoke a function. Only live shops are ever in it.
    const spots = (await listSpots(redis, ["active"])).map(publicSpot);
    return NextResponse.json({ spots }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    console.error("[spots/get]", e);
    return NextResponse.json({ spots: [] });
  }
}
