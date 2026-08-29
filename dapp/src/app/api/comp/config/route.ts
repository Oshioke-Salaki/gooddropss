import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getCompConfig, setCompConfig, type CompConfig } from "@/lib/competition";

export const runtime = "nodejs";

// GET  /api/comp/config          → current config (public; non-sensitive)
// POST /api/comp/config (admin)  → update pot / dates / tiers / min-drop / bonus.
// Body accepts whole G$ for pot, minDrop & tiers, and ISO strings or unix seconds
// for dates. Every field is optional — only what you send is changed.
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  return NextResponse.json(await getCompConfig(redis));
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const b = await req.json().catch(() => ({}));
  const patch: Partial<CompConfig> = {};

  if (b.pot !== undefined) {
    const n = Number(b.pot);
    if (!Number.isFinite(n) || n < 0) return bad("pot");
    patch.potWei = (BigInt(Math.round(n)) * 10n ** 18n).toString();
  }
  if (b.startsAt !== undefined) { const t = toUnix(b.startsAt); if (t === null) return bad("startsAt"); patch.startsAt = t; }
  if (b.endsAt !== undefined) { const t = toUnix(b.endsAt); if (t === null) return bad("endsAt"); patch.endsAt = t; }
  if (typeof b.id === "string" && b.id.trim()) patch.id = b.id.trim().slice(0, 64);
  if (b.tiers !== undefined) {
    // Accept an array of numbers or a comma-separated string of whole-G$ prizes.
    const raw = Array.isArray(b.tiers) ? b.tiers : String(b.tiers).split(",");
    const tiers = raw.map((x: unknown) => Number(String(x).trim())).filter((n: number) => Number.isFinite(n) && n >= 0);
    if (tiers.length === 0) return bad("tiers");
    patch.tiers = tiers;
  }
  if (b.minDrop !== undefined) {
    const n = Number(b.minDrop);
    if (!Number.isFinite(n) || n < 0) return bad("minDrop");
    patch.minDropWei = (BigInt(Math.round(n)) * 10n ** 18n).toString();
  }
  if (b.referralBonusWeight !== undefined) {
    const n = Number(b.referralBonusWeight);
    if (!Number.isFinite(n) || n < 0) return bad("referralBonusWeight");
    patch.referralBonusWeight = n;
  }
  if (b.downlineWeights !== undefined) {
    // Array of numbers or comma-separated fractions (e.g. "0.25, 0.1"). Each 0..1.
    const raw = Array.isArray(b.downlineWeights) ? b.downlineWeights : String(b.downlineWeights).split(",");
    const w = raw.map((x: unknown) => Number(String(x).trim())).filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 1);
    if (w.length === 0) return bad("downlineWeights");
    patch.downlineWeights = w.slice(0, 2);
  }

  if (patch.startsAt !== undefined && patch.endsAt !== undefined && patch.endsAt <= patch.startsAt) {
    return bad("endsAt (must be after startsAt)");
  }

  return NextResponse.json(await setCompConfig(redis, patch));
}

function bad(field: string) {
  return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
}
function toUnix(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") { const ms = Date.parse(v); if (!Number.isNaN(ms)) return Math.floor(ms / 1000); }
  return null;
}
