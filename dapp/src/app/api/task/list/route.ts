import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import type { TaskDropRecord } from "@/lib/taskShared";

export const runtime = "nodejs";

// GET /api/task/list?spotId=  — a spot's reward drops (newest first), for the
// merchant's "reward activity" view. Live claim status is read on-chain by the
// client (via multicall) so this stays fast and RPC-independent.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ rewards: [] });
  const spotId = req.nextUrl.searchParams.get("spotId") ?? "";
  if (!spotId) return NextResponse.json({ error: "spotId required" }, { status: 400 });

  const ids = await redis.lrange<string>(keys.taskDropsBySpot(spotId), 0, 99);
  if (!ids || ids.length === 0) return NextResponse.json({ rewards: [] });

  const recs = await redis.mget<(TaskDropRecord | null)[]>(...ids.map((id) => keys.taskDrop(id)));
  const rewards = ids
    .map((dropId, i) => ({ dropId, ...(recs[i] ?? {}) }))
    .filter((r) => (r as { spotId?: string }).spotId === spotId);

  return NextResponse.json({ rewards });
}
