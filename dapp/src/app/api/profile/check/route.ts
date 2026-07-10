import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

// Fail fast on network blips — the default (5 retries, exponential backoff)
// makes requests hang for 20–30s when DNS/network hiccups.
const redis = Redis.fromEnv({ retry: { retries: 1, backoff: () => 300 } });

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
const RESERVED    = new Set(["admin","gooddrops","gooddollar","celo","support","system"]);

// GET /api/profile/check?username=hunter
export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");
  if (!username) return NextResponse.json({ available: false, error: "username required" });

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ available: false, error: "Invalid format" });
  }
  if (RESERVED.has(username.toLowerCase())) {
    return NextResponse.json({ available: false, error: "Reserved" });
  }

  try {
    const taken = await redis.get(`gd:username:${username.toLowerCase()}`);
    return NextResponse.json({ available: !taken });
  } catch (e) {
    // Redis unreachable — can't confirm availability, fail closed without a 500
    console.error("[profile/check]", e);
    return NextResponse.json({ available: false, error: "Try again in a moment" });
  }
}
