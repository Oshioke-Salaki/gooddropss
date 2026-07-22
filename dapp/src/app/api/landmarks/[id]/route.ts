import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAddress } from "@/lib/admins";
import {
  cleanLandmarkName, isLandmarkCategory, landmarkActionMessage,
  LANDMARK_ID_RE, LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
} from "@/lib/landmarks";
import type { Landmark } from "@/types";

export const runtime = "nodejs";

const SIG_WINDOW = 24 * 60 * 60 * 1000;

function parseLandmark(raw: string | Landmark | null): Landmark | null {
  if (raw == null) return null;
  try { return typeof raw === "string" ? (JSON.parse(raw) as Landmark) : raw; }
  catch { return null; }
}

// Verify an admin signed the action for THIS id. Returns an error response or null.
async function requireAdmin(
  action: "update" | "delete",
  id: string,
  signature: unknown,
  timestamp: unknown,
): Promise<NextResponse | null> {
  if (!LANDMARK_ID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (typeof signature !== "string" || !signature.startsWith("0x"))
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
    return NextResponse.json({ error: "Missing timestamp" }, { status: 400 });
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW)
    return NextResponse.json({ error: "Signature expired — try again" }, { status: 400 });

  let signer: string;
  try {
    signer = (await recoverMessageAddress({
      message: landmarkActionMessage(action, id, timestamp),
      signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  if (!isAdminAddress(signer)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  return null;
}

// PATCH /api/landmarks/[id] — edit name/category/note/status (admin)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { name?: string; category?: string; note?: string; status?: string; signature?: string; timestamp?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const denied = await requireAdmin("update", id, body.signature, body.timestamp);
  if (denied) return denied;

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    const existing = parseLandmark(await redis.get(keys.landmark(id)));
    if (!existing) return NextResponse.json({ error: "Landmark not found" }, { status: 404 });

    const next: Landmark = { ...existing };

    if (body.name !== undefined) {
      const name = cleanLandmarkName(body.name);
      if (name.length < LANDMARK_NAME_MIN || name.length > LANDMARK_NAME_MAX)
        return NextResponse.json({ error: `Name must be ${LANDMARK_NAME_MIN}–${LANDMARK_NAME_MAX} characters` }, { status: 400 });
      next.name = name;
    }
    if (body.category !== undefined) {
      if (!isLandmarkCategory(body.category))
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      next.category = body.category;
    }
    if (body.note !== undefined) {
      next.note = cleanLandmarkName(body.note).slice(0, LANDMARK_NOTE_MAX) || undefined;
    }
    if (body.status !== undefined) {
      // "active" also serves as APPROVE for a pending suggestion.
      if (body.status !== "active" && body.status !== "hidden")
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      next.status = body.status;
    }
    next.updatedAt = Math.floor(Date.now() / 1000);

    await redis.set(keys.landmark(id), JSON.stringify(next));

    // Approving a suggestion clears it from the suggester's pending quota.
    if (existing.status === "pending" && next.status !== "pending" && existing.createdBy)
      await redis.srem(keys.landmarksPendingByWallet(existing.createdBy), id);

    return NextResponse.json({ landmark: next });
  } catch (e) {
    console.error("[landmarks/patch]", e);
    return NextResponse.json({ error: "Could not update landmark" }, { status: 500 });
  }
}

// DELETE /api/landmarks/[id] — remove a landmark (admin)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { signature?: string; timestamp?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const denied = await requireAdmin("delete", id, body.signature, body.timestamp);
  if (denied) return denied;

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    // Rejecting/deleting a pending suggestion frees the suggester's quota slot.
    const existing = parseLandmark(await redis.get(keys.landmark(id)));
    if (existing?.status === "pending" && existing.createdBy)
      await redis.srem(keys.landmarksPendingByWallet(existing.createdBy), id);

    await redis.srem(keys.landmarksIndex(), id);
    await redis.del(keys.landmark(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[landmarks/delete]", e);
    return NextResponse.json({ error: "Could not delete landmark" }, { status: 500 });
  }
}
