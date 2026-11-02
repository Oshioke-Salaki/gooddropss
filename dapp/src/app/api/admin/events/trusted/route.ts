import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_TRUSTED = 500;

/**
 * Trusted hosts: partner wallets whose events and edits go live without review.
 *   GET                         → { hosts: string[] }
 *   POST { address, trusted }   → add (true) or remove (false)
 */
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const hosts = (await redis.smembers(keys.eventsTrusted())).sort();
  return NextResponse.json({ hosts }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: { address?: unknown; trusted?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const address = typeof body.address === "string" ? body.address.trim().toLowerCase() : "";
  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "That isn't a wallet address." }, { status: 400 });

  if (body.trusted === true) {
    if ((await redis.scard(keys.eventsTrusted())) >= MAX_TRUSTED) {
      return NextResponse.json({ error: `At most ${MAX_TRUSTED} trusted hosts.` }, { status: 409 });
    }
    await redis.sadd(keys.eventsTrusted(), address);
  } else if (body.trusted === false) {
    await redis.srem(keys.eventsTrusted(), address);
  } else {
    return NextResponse.json({ error: "Say whether to trust them." }, { status: 400 });
  }
  const hosts = (await redis.smembers(keys.eventsTrusted())).sort();
  return NextResponse.json({ hosts });
}
