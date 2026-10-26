import { NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getEvents, statsFor } from "@/lib/eventStore";
import { statsToJson } from "@/lib/events";

export const runtime = "nodejs";

/** GET /api/admin/events — the review queue plus the 100 most recent events. */
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const [reviewIds, recentIds] = await Promise.all([
    redis.smembers(keys.eventsReview()),
    redis.zrange<string[]>(keys.eventsAll(), 0, 99, { rev: true }),
  ]);
  const all = await getEvents(redis, [...new Set([...reviewIds, ...recentIds])]);
  const stats = await statsFor(all);
  const byId = new Map(all.map((e) => [e.id, e]));
  const row = (id: string) => byId.has(id) ? { event: byId.get(id)!, stats: statsToJson(stats.get(id)!) } : null;
  return NextResponse.json(
    {
      review: reviewIds.map(row).filter(Boolean).sort((a, b) => a!.event.createdAt - b!.event.createdAt),
      recent: recentIds.map(row).filter(Boolean),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
