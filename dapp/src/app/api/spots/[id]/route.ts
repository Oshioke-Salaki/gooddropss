import { NextRequest, NextResponse } from "next/server";
import type { Redis } from "@upstash/redis";
import { getRedis } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { verifyWalletSig } from "@/lib/walletSig";
import { startSessionQuietly } from "@/lib/walletSession";
import { pickSpotPatch, spotDigest, spotMessage, SPOT_CATEGORIES, type SpotAction } from "@/lib/spotAuth";
import { spotStatus } from "@/lib/spotStatus";
import { deleteSpot, getSpot, saveSpot, withSpotLock } from "@/lib/spotStore";
import type { Spot, SpotStatus } from "@/types";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const BUSY = () => NextResponse.json({ error: "This shop is being updated. Try again in a moment." }, { status: 409 });

// Check the owner's signature on exactly this action and content.
function ownerSig(redis: Redis, spot: Spot, action: SpotAction, body: Record<string, unknown>, content: Parameters<typeof spotDigest>[0]) {
  return verifyWalletSig(redis, {
    address: spot.ownerAddress, signature: body.signature, timestamp: body.timestamp,
    message: (ts) => spotMessage(action, spot.id, ts, spotDigest(content)),
  });
}

// PATCH /api/spots/[id] — edit business details. Admin (cookie) or owner (signed).
// Editing never changes the moderation status.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const body: Record<string, unknown> = await req.json().catch(() => ({}));

  const patch = pickSpotPatch(body);
  if (patch.name !== undefined && (patch.name.length < 2 || String(body.name).trim().length > 60))
    return NextResponse.json({ error: "Name must be 2–60 characters" }, { status: 400 });
  if (patch.category !== undefined && !(SPOT_CATEGORIES as readonly string[]).includes(patch.category))
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (patch.wallet !== undefined && !ADDR_RE.test(patch.wallet))
    return NextResponse.json({ error: "Invalid payout wallet" }, { status: 400 });
  if ((patch.lat !== undefined) !== (patch.lng !== undefined))
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  if (patch.lat !== undefined && (!Number.isFinite(patch.lat) || !Number.isFinite(patch.lng!)
    || Math.abs(patch.lat) > 90 || Math.abs(patch.lng!) > 180))
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });

  const result = await withSpotLock(redis, id, async () => {
    const spot = await getSpot(redis, id);
    if (!spot) return NextResponse.json({ error: "Business not found" }, { status: 404 });

    const admin = await isAdminAuthed();
    if (!admin) {
      const err = await ownerSig(redis, spot, "edit", body, patch);
      if (err) return NextResponse.json({ error: err }, { status: 401 });
    }

    const next: Spot = { ...spot };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.discount !== undefined) next.discount = patch.discount;
    if (patch.category !== undefined) next.category = patch.category;
    if (patch.wallet !== undefined) next.wallet = patch.wallet;
    if (patch.lat !== undefined && patch.lng !== undefined) { next.lat = patch.lat; next.lng = patch.lng; }
    if (patch.placeName !== undefined) {
      if (patch.placeName) next.placeName = patch.placeName; else delete next.placeName;
    }
    next.updatedAt = Math.floor(Date.now() / 1000);

    await saveSpot(redis, next);
    if (!admin) await startSessionQuietly(redis, spot.ownerAddress);
    return NextResponse.json({ spot: next });
  });
  return result ?? BUSY();
}

// POST /api/spots/[id] — change moderation status.
//   merchant (signed): pause | reactivate (only from paused)
//   admin (cookie):    approve | reject | suspend | reactivate
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  const result = await withSpotLock(redis, id, async () => {
    const spot = await getSpot(redis, id);
    if (!spot) return NextResponse.json({ error: "Business not found" }, { status: 404 });

    const cur = spotStatus(spot);
    const admin = await isAdminAuthed();
    // A signed request is a MERCHANT action (pause/reactivate): route it as such
    // even when the caller also happens to be an admin, so an admin who owns a shop
    // can still pause it from the merchant page instead of hitting "Unknown admin
    // action". Admin-console actions carry no signature and fall to the admin branch.
    const hasSig = typeof body.signature === "string" && body.signature.length > 0;
    let nextStatus: SpotStatus;

    if (admin && !hasSig) {
      switch (action) {
        case "approve":    if (cur !== "pending") return conflict("Only pending businesses can be approved."); nextStatus = "active"; break;
        case "reject":     if (cur !== "pending") return conflict("Only pending businesses can be rejected."); nextStatus = "rejected"; break;
        case "suspend":    if (cur === "suspended") return conflict("Already suspended."); nextStatus = "suspended"; break;
        case "reactivate": if (cur !== "suspended" && cur !== "paused") return conflict("Nothing to reactivate."); nextStatus = "active"; break;
        default: return NextResponse.json({ error: "Unknown admin action" }, { status: 400 });
      }
    } else {
      if (action !== "pause" && action !== "reactivate") {
        return NextResponse.json({ error: "Merchants can only pause or reactivate." }, { status: 403 });
      }
      // Merchant must prove ownership of exactly this action.
      const err = await ownerSig(redis, spot, action, body, null);
      if (err) return NextResponse.json({ error: err }, { status: 401 });
      if (action === "pause") {
        if (cur === "suspended") return NextResponse.json({ error: "This business was suspended by an admin. Contact support." }, { status: 403 });
        if (cur !== "active") return conflict("Only a live business can be paused.");
        nextStatus = "paused";
      } else {
        if (cur === "suspended") return NextResponse.json({ error: "Suspended by an admin. Only an admin can restore it." }, { status: 403 });
        if (cur === "pending") return NextResponse.json({ error: "Still awaiting admin approval." }, { status: 403 });
        if (cur !== "paused") return conflict("This business isn't paused.");
        nextStatus = "active";
      }
    }

    const next: Spot = { ...spot, status: nextStatus, updatedAt: Math.floor(Date.now() / 1000) };
    if (admin && !hasSig && typeof body.note === "string") next.note = body.note.trim().slice(0, 200);
    await saveSpot(redis, next);
    if (hasSig) await startSessionQuietly(redis, spot.ownerAddress);
    return NextResponse.json({ spot: next });
  });
  return result ?? BUSY();
}

// DELETE /api/spots/[id] — permanently remove a business. Admin only. Intended
// for hidden/rejected/suspended spam so it stops cluttering the console. Purges
// the record and every index that referenced it.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const result = await withSpotLock(redis, id, async () => {
    const spot = await getSpot(redis, id);
    if (!spot) return NextResponse.json({ error: "Business not found" }, { status: 404 });
    await deleteSpot(redis, spot);
    return NextResponse.json({ ok: true });
  });
  return result ?? BUSY();
}

function conflict(msg: string) {
  return NextResponse.json({ error: msg }, { status: 409 });
}
