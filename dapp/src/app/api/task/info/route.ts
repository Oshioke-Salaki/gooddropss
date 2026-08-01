import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import type { TaskDropRecord } from "@/lib/taskShared";

export const runtime = "nodejs";

// GET /api/task/info?dropId=  — public task text for a task drop (so the hunter
// knows what to do before minting a QR). No PII.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ task: null });
  const dropId = req.nextUrl.searchParams.get("dropId") ?? "";
  if (!/^\d+$/.test(dropId)) return NextResponse.json({ error: "Invalid drop" }, { status: 400 });
  const rec = await redis.get<TaskDropRecord>(keys.taskDrop(dropId));
  return NextResponse.json({ task: rec?.task ?? null, spotId: rec?.spotId ?? null });
}
