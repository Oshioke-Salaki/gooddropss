import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { getEvents } from "@/lib/eventStore";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed, same as the other crons
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

/**
 * GET /api/cron/events — hourly. Reminds everyone who tapped "Remind me" that
 * an event starts within roughly the next hour and a half. Each event is
 * reminded once (an NX marker), so a re-run or an overlapping window can't
 * double-send. `?dry=1` lists what would be sent without sending.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const now = Math.floor(Date.now() / 1000);
  const ids = await redis.zrange<string[]>(keys.eventsPublic(), now, now + 90 * 60, { byScore: true });
  const events = (await getEvents(redis, ids)).filter((e) => e.status === "approved" && e.startsAt > now);

  const report: { id: string; title: string; recipients: number; sent: number; skipped?: string }[] = [];
  const deadline = Date.now() + 45_000;

  for (const e of events) {
    const who = await redis.smembers(keys.eventInterested(e.id));
    if (dry) { report.push({ id: e.id, title: e.title, recipients: who.length, sent: 0, skipped: "dry run" }); continue; }
    const first = await redis.set(keys.eventReminded(e.id), "1", { nx: true, ex: 3 * 86_400 });
    if (first === null) { report.push({ id: e.id, title: e.title, recipients: who.length, sent: 0, skipped: "already reminded" }); continue; }

    const mins = Math.max(5, Math.round((e.startsAt - now) / 60 / 5) * 5);
    let sent = 0;
    for (const a of who) {
      if (Date.now() > deadline) break;
      const r = await sendPush(redis, a, {
        title: `${e.title} starts in about ${mins >= 60 ? "an hour" : `${mins} minutes`}`,
        body: `${e.venueName}. G$ drops unlock when it starts.`,
        url: `/events/${e.id}`,
        tag: `event-${e.id}`,
      }).catch(() => null);
      if (r?.ok) sent++;
    }
    report.push({ id: e.id, title: e.title, recipients: who.length, sent });
  }
  return NextResponse.json({ ok: true, events: report });
}
