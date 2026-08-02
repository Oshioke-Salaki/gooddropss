import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { spotActionMessage } from "@/lib/spotAuth";
import { spotStatus } from "@/lib/spotStatus";
import type { Spot, SpotStatus } from "@/types";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const CATEGORIES = ["food", "retail", "services", "transport", "other"];
const SIG_WINDOW = 24 * 60 * 60 * 1000;

async function loadSpot(id: string): Promise<{ redis: ReturnType<typeof getRedis>; spot: Spot | null }> {
  const redis = getRedis();
  if (!redis) return { redis, spot: null };
  const raw = await redis.get<string | Spot>(keys.spot(id));
  const spot = raw ? (typeof raw === "string" ? (JSON.parse(raw) as Spot) : raw) : null;
  return { redis, spot };
}

// Verify a merchant-signed action against the spot's owner.
async function ownerSigned(spot: Spot, action: string, id: string, signature: unknown, timestamp: unknown): Promise<boolean> {
  if (typeof signature !== "string" || typeof timestamp !== "number") return false;
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW) return false;
  try {
    return await verifyMessage({
      address: spot.ownerAddress as `0x${string}`,
      message: spotActionMessage(action, id, timestamp),
      signature: signature as `0x${string}`,
    });
  } catch { return false; }
}

// PATCH /api/spots/[id] — edit business details. Admin (cookie) or owner (signed).
// Editing never changes the moderation status.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { redis, spot } = await loadSpot(id);
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  if (!spot) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const admin = await isAdminAuthed();
  if (!admin && !(await ownerSigned(spot, "edit", id, body.signature, body.timestamp))) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const next: Spot = { ...spot };
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n.length < 2 || n.length > 60) return NextResponse.json({ error: "Name must be 2–60 characters" }, { status: 400 });
    next.name = n;
  }
  if (body.description !== undefined) next.description = String(body.description).trim().slice(0, 280);
  if (body.discount !== undefined) next.discount = String(body.discount).trim().slice(0, 80);
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    next.category = body.category;
  }
  if (body.wallet !== undefined) {
    if (!ADDR_RE.test(body.wallet)) return NextResponse.json({ error: "Invalid payout wallet" }, { status: 400 });
    next.wallet = String(body.wallet).toLowerCase();
  }
  // Re-pin location (merchant fixed a wrong pin, or added a place name).
  if (body.lat !== undefined || body.lng !== undefined) {
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    next.lat = lat; next.lng = lng;
  }
  if (body.placeName !== undefined) {
    const p = String(body.placeName).trim().slice(0, 80);
    if (p) next.placeName = p; else delete next.placeName;
  }
  next.updatedAt = Math.floor(Date.now() / 1000);

  await redis.set(keys.spot(id), JSON.stringify(next));
  return NextResponse.json({ spot: next });
}

// POST /api/spots/[id] — change moderation status.
//   merchant (signed): pause | reactivate (only from paused)
//   admin (cookie):    approve | reject | suspend | reactivate
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const { redis, spot } = await loadSpot(id);
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  if (!spot) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const cur = spotStatus(spot);
  const admin = await isAdminAuthed();
  // A signed request is a MERCHANT action (pause/reactivate) — route it as such
  // even when the caller also happens to be an admin, so an admin who owns a shop
  // can still pause it from the merchant page instead of hitting "Unknown admin
  // action". Admin-console actions carry no signature and fall to the admin branch.
  const hasSig = typeof body.signature === "string" && body.signature.length > 0;
  let nextStatus: SpotStatus | null = null;

  if (admin && !hasSig) {
    switch (action) {
      case "approve":    if (cur !== "pending") return conflict("Only pending businesses can be approved."); nextStatus = "active"; break;
      case "reject":     if (cur !== "pending") return conflict("Only pending businesses can be rejected."); nextStatus = "rejected"; break;
      case "suspend":    if (cur === "suspended") return conflict("Already suspended."); nextStatus = "suspended"; break;
      case "reactivate": if (cur !== "suspended" && cur !== "paused") return conflict("Nothing to reactivate."); nextStatus = "active"; break;
      default: return NextResponse.json({ error: "Unknown admin action" }, { status: 400 });
    }
  } else {
    // Merchant must prove ownership.
    if (!(await ownerSigned(spot, action, id, body.signature, body.timestamp))) {
      return NextResponse.json({ error: "Not authorised" }, { status: 401 });
    }
    switch (action) {
      case "pause":
        if (cur === "suspended") return NextResponse.json({ error: "This business was suspended by an admin — contact support." }, { status: 403 });
        if (cur !== "active") return conflict("Only a live business can be paused.");
        nextStatus = "paused"; break;
      case "reactivate":
        if (cur === "suspended") return NextResponse.json({ error: "Suspended by an admin — only an admin can restore it." }, { status: 403 });
        if (cur === "pending") return NextResponse.json({ error: "Still awaiting admin approval." }, { status: 403 });
        if (cur !== "paused") return conflict("This business isn't paused.");
        nextStatus = "active"; break;
      default: return NextResponse.json({ error: "Merchants can only pause or reactivate." }, { status: 403 });
    }
  }

  const next: Spot = { ...spot, status: nextStatus, updatedAt: Math.floor(Date.now() / 1000) };
  if (admin && typeof body.note === "string") next.note = body.note.trim().slice(0, 200);
  await redis.set(keys.spot(id), JSON.stringify(next));
  return NextResponse.json({ spot: next });
}

// DELETE /api/spots/[id] — permanently remove a business. Admin only. Intended
// for hidden/rejected/suspended spam so it stops cluttering the console. Purges
// the record and every index that referenced it.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  const { redis, spot } = await loadSpot(id);
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  if (!spot) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  await Promise.all([
    redis.del(keys.spot(id)),
    redis.lrem(keys.spotsAll(), 0, id),
    spot.ownerAddress ? redis.lrem(keys.spotsByOwner(spot.ownerAddress), 0, id) : Promise.resolve(0),
    redis.del(keys.spotPayments(id)),
  ]);
  return NextResponse.json({ ok: true });
}

function conflict(msg: string) {
  return NextResponse.json({ error: msg }, { status: 409 });
}
