import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getRefCompConfig, setRefCompConfig, type RefCompConfig } from "@/lib/competition";

export const runtime = "nodejs";

// GET  /api/comp/referrals/config          → current referral-competition config
// POST /api/comp/referrals/config (admin)  → update pot / per-referral / threshold /
// dates / id. Whole G$ for pot & perReferral; ISO strings or unix seconds for dates.
// Every field is optional — only what you send is changed.
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  return NextResponse.json(await getRefCompConfig(redis));
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const b = await req.json().catch(() => ({}));
  const patch: Partial<RefCompConfig> = {};

  if (b.pot !== undefined) {
    const n = Number(b.pot);
    if (!Number.isFinite(n) || n < 0) return bad("pot");
    patch.potWei = (BigInt(Math.round(n)) * 10n ** 18n).toString();
  }
  if (b.perReferral !== undefined) {
    const n = Number(b.perReferral);
    if (!Number.isFinite(n) || n <= 0) return bad("perReferral");
    patch.perReferralWei = (BigInt(Math.round(n)) * 10n ** 18n).toString();
  }
  if (b.threshold !== undefined) {
    const n = Number(b.threshold);
    if (!Number.isInteger(n) || n < 1) return bad("threshold");
    patch.threshold = n;
  }
  if (b.startsAt !== undefined) { const t = toUnix(b.startsAt); if (t === null) return bad("startsAt"); patch.startsAt = t; }
  if (b.endsAt !== undefined) { const t = toUnix(b.endsAt); if (t === null) return bad("endsAt"); patch.endsAt = t; }
  // Changing the id starts a FRESH participant set (gd:comp:referrers:<id>), which
  // is exactly what you want for a new season — never mid-competition.
  if (typeof b.id === "string" && b.id.trim()) patch.id = b.id.trim().slice(0, 64);

  if (patch.startsAt !== undefined && patch.endsAt !== undefined && patch.endsAt <= patch.startsAt) {
    return bad("endsAt (must be after startsAt)");
  }

  return NextResponse.json(await setRefCompConfig(redis, patch));
}

function bad(field: string) {
  return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
}
function toUnix(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") { const ms = Date.parse(v); if (!Number.isNaN(ms)) return Math.floor(ms / 1000); }
  return null;
}
