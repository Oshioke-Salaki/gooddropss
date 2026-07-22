import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAddress } from "@/lib/admins";
import {
  cleanLandmarkName, isLandmarkCategory, landmarkCreateMessage,
  LANDMARK_ID_RE, LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
} from "@/lib/landmarks";
import type { Landmark } from "@/types";

export const runtime = "nodejs";

// Admin-only, low-harm, idempotent-by-id → a generous window tolerates device
// clock skew (see the username-signature reasoning) without any real risk.
const SIG_WINDOW = 24 * 60 * 60 * 1000;

function parseLandmark(raw: string | Landmark | null): Landmark | null {
  if (raw == null) return null;
  try { return typeof raw === "string" ? (JSON.parse(raw) as Landmark) : raw; }
  catch { return null; }
}

// GET /api/landmarks            → active landmarks (lean payload for the map)
// GET /api/landmarks?scope=all  → every landmark incl. hidden (admin management)
export async function GET(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) return NextResponse.json({ landmarks: [] });

    const ids = await redis.smembers(keys.landmarksIndex());
    if (!ids || ids.length === 0) return NextResponse.json({ landmarks: [] });

    const raw = await redis.mget<(string | Landmark | null)[]>(...ids.map((id) => keys.landmark(id)));
    let landmarks = raw
      .map(parseLandmark)
      .filter((l): l is Landmark => l !== null);

    if (req.nextUrl.searchParams.get("scope") !== "all") {
      landmarks = landmarks.filter((l) => l.status === "active");
    }
    return NextResponse.json({ landmarks });
  } catch (e) {
    console.error("[landmarks/get]", e);
    return NextResponse.json({ landmarks: [] });
  }
}

// POST /api/landmarks — create/overwrite a landmark (admin wallet signature)
// Body: { id, name, category, lat, lng, note?, signature, timestamp }
export async function POST(req: NextRequest) {
  let body: {
    id?: string; name?: string; category?: string; lat?: number; lng?: number;
    note?: string; signature?: string; timestamp?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { id, category, lat, lng, signature, timestamp } = body;

  // ── Structural validation ──────────────────────────────────────────────────
  if (!id || !LANDMARK_ID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!signature || typeof signature !== "string" || !signature.startsWith("0x"))
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
    return NextResponse.json({ error: "Missing timestamp" }, { status: 400 });
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW)
    return NextResponse.json({ error: "Signature expired — try again" }, { status: 400 });

  const name = cleanLandmarkName(typeof body.name === "string" ? body.name : "");
  if (name.length < LANDMARK_NAME_MIN || name.length > LANDMARK_NAME_MAX)
    return NextResponse.json({ error: `Name must be ${LANDMARK_NAME_MIN}–${LANDMARK_NAME_MAX} characters` }, { status: 400 });
  if (!isLandmarkCategory(category))
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (typeof lat !== "number" || typeof lng !== "number" ||
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
      (lat === 0 && lng === 0))
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });

  const note = typeof body.note === "string"
    ? cleanLandmarkName(body.note).slice(0, LANDMARK_NOTE_MAX)
    : undefined;

  // ── Auth: recover signer, must be an admin. The signed message is rebuilt from
  // the SAME validated fields, so a signature can't be reused for other data. ──
  let signer: string;
  try {
    signer = (await recoverMessageAddress({
      message: landmarkCreateMessage({ id, name, category, lat, lng, timestamp }),
      signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  if (!isAdminAddress(signer)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    // Preserve original createdAt/createdBy if this id already exists (idempotent).
    const prev = parseLandmark(await redis.get(keys.landmark(id)));
    const now = Math.floor(Date.now() / 1000);
    const landmark: Landmark = {
      id,
      name,
      category,
      lat,
      lng,
      createdBy: prev?.createdBy ?? signer,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      status: "active",
      ...(note ? { note } : {}),
    };
    await redis.set(keys.landmark(id), JSON.stringify(landmark));
    await redis.sadd(keys.landmarksIndex(), id); // Set → no duplicate index entries
    return NextResponse.json({ landmark });
  } catch (e) {
    console.error("[landmarks/post]", e);
    return NextResponse.json({ error: "Could not save landmark" }, { status: 500 });
  }
}
