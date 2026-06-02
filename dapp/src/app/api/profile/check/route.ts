import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

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

  const taken = await redis.get(`gd:username:${username.toLowerCase()}`);
  return NextResponse.json({ available: !taken });
}
