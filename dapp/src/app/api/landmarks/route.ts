import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAddress } from "@/lib/admins";
import { isVerifiedHuman } from "@/lib/identityRoot";
import {
  cleanLandmarkName, isLandmarkCategory, landmarkCreateMessage,
  LANDMARK_ID_RE, LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
} from "@/lib/landmarks";
import type { Landmark } from "@/types";

export const runtime = "nodejs";

// Idempotent-by-id → a generous window tolerates device clock skew (see the
// username-signature reasoning) without any real risk.
const SIG_WINDOW = 24 * 60 * 60 * 1000;
// How many suggestions one human may have awaiting review at once.
const MAX_PENDING_PER_WALLET = 20;

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

  // ── Auth: recover signer. The signed message is rebuilt from the SAME validated
  // fields, so a signature can't be reused for other data. Two paths:
  //   • admin        → landmark goes live immediately (status "active")
  //   • verified human → it becomes a SUGGESTION for admin review (status "pending")
  //   • anyone else  → rejected. ──
  let signer: string;
  try {
    signer = (await recoverMessageAddress({
      message: landmarkCreateMessage({ id, name, category, lat, lng, timestamp }),
      signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const isAdmin = isAdminAddress(signer);

  // The SERVER decides the status — a suggester can't smuggle in "active".
  let status: "active" | "pending" = "active";
  if (!isAdmin) {
    if (!(await isVerifiedHuman(signer)))
      return NextResponse.json(
        { error: "Verify with GoodDollar first to suggest a place." },
        { status: 403 },
      );
    // Anti-flood: bound how many suggestions one human can have in the queue.
    const pendKey = keys.landmarksPendingByWallet(signer);
    const [pendingCount, alreadyMine] = await Promise.all([
      redis.scard(pendKey),
      redis.sismember(pendKey, id),
    ]);
    if (pendingCount >= MAX_PENDING_PER_WALLET && !alreadyMine)
      return NextResponse.json(
        { error: "You have too many suggestions awaiting review. Please wait for some to be reviewed." },
        { status: 429 },
      );
    status = "pending";
  }

  try {
    // Preserve original createdAt/createdBy if this id already exists (idempotent).
    const prev = parseLandmark(await redis.get(keys.landmark(id)));

    // A non-admin may only write a brand-new id or re-edit their OWN pending
    // suggestion — never overwrite a live/admin landmark or someone else's row
    // (the id is client-generated, so guessing an existing one is possible).
    if (!isAdmin && prev && !(prev.status === "pending" && prev.createdBy === signer))
      return NextResponse.json({ error: "That place already exists." }, { status: 409 });

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
      status,
      ...(note ? { note } : {}),
    };
    await redis.set(keys.landmark(id), JSON.stringify(landmark));
    await redis.sadd(keys.landmarksIndex(), id); // Set → no duplicate index entries
    if (status === "pending")
      await redis.sadd(keys.landmarksPendingByWallet(signer), id);
    return NextResponse.json({ landmark });
  } catch (e) {
    console.error("[landmarks/post]", e);
    return NextResponse.json({ error: "Could not save landmark" }, { status: 500 });
  }
}
