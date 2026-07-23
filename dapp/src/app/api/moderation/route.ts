import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import type { DropReport } from "@/lib/reports";

export const runtime = "nodejs";

function parseReport(raw: string | DropReport | null): DropReport | null {
  if (raw == null) return null;
  try { return typeof raw === "string" ? (JSON.parse(raw) as DropReport) : raw; }
  catch { return null; }
}

interface ReportedDrop {
  dropId:  string;
  count:   number;
  lastTs:  number;
  reports: DropReport[];
  hidden:  boolean;
}

// GET /api/moderation — the review queue (admin cookie only).
export async function GET() {
  if (!(await isAdminAuthed()))
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ reported: [], hidden: [] });

  try {
    const [dropIds, hidden] = await Promise.all([
      redis.smembers(keys.reportedDropsIndex()),
      redis.smembers(keys.hiddenDrops()),
    ]);
    const hiddenSet = new Set(hidden ?? []);

    const reported: ReportedDrop[] = [];
    for (const dropId of dropIds ?? []) {
      const reporters = await redis.smembers(keys.dropReporters(dropId));
      if (!reporters || reporters.length === 0) continue;
      const raw = await redis.mget<(string | DropReport | null)[]>(
        ...reporters.map((r) => keys.dropReport(dropId, r)),
      );
      const reports = raw.map(parseReport).filter((r): r is DropReport => r !== null);
      if (reports.length === 0) continue;
      reported.push({
        dropId,
        count: reports.length,
        lastTs: reports.reduce((m, r) => Math.max(m, r.ts), 0),
        reports: reports.sort((a, b) => b.ts - a.ts),
        hidden: hiddenSet.has(dropId),
      });
    }
    // Most recently-reported first.
    reported.sort((a, b) => b.lastTs - a.lastTs);
    return NextResponse.json({ reported, hidden: Array.from(hiddenSet) });
  } catch (e) {
    console.error("[moderation/get]", e);
    return NextResponse.json({ error: "Could not load queue" }, { status: 500 });
  }
}

// POST /api/moderation — admin action (admin cookie only).
// Body: { action: "hide" | "unhide" | "dismiss", dropId }
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed()))
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });

  let body: { action?: string; dropId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { action, dropId } = body;
  if (!dropId || typeof dropId !== "string" || !/^[0-9]{1,20}$/.test(dropId))
    return NextResponse.json({ error: "Invalid drop" }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    if (action === "hide") {
      await redis.sadd(keys.hiddenDrops(), dropId);
    } else if (action === "unhide") {
      await redis.srem(keys.hiddenDrops(), dropId);
    } else if (action === "dismiss") {
      // Clear the report queue for this drop (leave any hidden state as-is).
      const reporters = await redis.smembers(keys.dropReporters(dropId));
      if (reporters && reporters.length > 0)
        await redis.del(...reporters.map((r) => keys.dropReport(dropId, r)));
      await redis.del(keys.dropReporters(dropId));
      await redis.srem(keys.reportedDropsIndex(), dropId);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[moderation/post]", e);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
