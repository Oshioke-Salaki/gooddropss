import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { clientIp } from "@/lib/eventAuth";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/profile/resolve?username=bola → { username, address }
// Lets people send G$ to a GoodDrops username instead of a 0x address. The
// address is the wallet that person uses in GoodDrops when we know it, else
// their GoodDollar identity wallet (both belong to the same verified person).
// Usernames are public on the leaderboard; this is rate limited per IP anyway.
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("username") ?? "").trim().replace(/^@/, "");
  if (!USERNAME_RE.test(raw)) return NextResponse.json({ error: "Not a username" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Try again in a moment" }, { status: 503 });
  try {
    const rl = `gd:resolve:rl:${clientIp(req.headers)}`;
    const n = await redis.incr(rl);
    if (n === 1) await redis.expire(rl, 60);
    if (n > 60) return NextResponse.json({ error: "Too many lookups. Wait a moment." }, { status: 429 });

    const root = await redis.get<string>(`gd:username:${raw.toLowerCase()}`);
    if (!root || !ADDR_RE.test(root)) return NextResponse.json({ error: "No one has that username" }, { status: 404 });
    const [profile, active] = await Promise.all([
      redis.get<{ username: string }>(`gd:profile:${root.toLowerCase()}`),
      redis.get<string>(keys.compPayoutWallet(root)),
    ]);
    const address = active && ADDR_RE.test(active) ? active : root;
    return NextResponse.json({ username: profile?.username ?? raw, address: address.toLowerCase() }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    console.error("[profile/resolve]", e);
    return NextResponse.json({ error: "Try again in a moment" }, { status: 503 });
  }
}
