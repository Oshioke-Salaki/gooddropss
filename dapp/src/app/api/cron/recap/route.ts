import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { weekBounds, evaluateQuests } from "@/lib/quests";
import { fetchWeekActivity } from "@/lib/weekActivity";
import { sendPush } from "@/lib/push";
import { formatG$ } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

// Per run. The cron fires hourly through Monday morning (see vercel.json), and
// the cursor + per-week "sent" marker carry on where the last run stopped, so a
// large subscriber list is covered across runs without anyone hearing twice.
// A run also stops starting new work after TIME_BUDGET_MS, well inside
// maxDuration, and saves the cursor where it actually got to.
const BATCH = Number(process.env.RECAP_BATCH ?? 150);
const TIME_BUDGET_MS = 40_000;
const CONCURRENCY = 8;
const SENT_TTL_S = 8 * 24 * 60 * 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed, same as /api/cron/reverify
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

// GET /api/cron/recap — Monday recap of LAST week for push subscribers.
// Skips anyone with no activity: a "you did nothing" push is a reason to turn
// notifications off.
//
// `?dry=1` (still needs the cron secret) computes the messages for the next
// batch and returns them without sending, moving the cursor or marking anyone
// — for checking copy and numbers against real data before a Monday.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: false, reason: "No storage" });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const nowS = Math.floor(Date.now() / 1000);
  // Dry runs may look further back (`weeksAgo`) to preview a busier week.
  const weeksAgo = dry ? Math.min(52, Math.max(1, Number(req.nextUrl.searchParams.get("weeksAgo")) || 1)) : 1;
  const lastWeek = weekBounds(nowS - weeksAgo * 7 * 86_400);

  try {
    const all = (await redis.smembers(keys.subscribersIndex())) ?? [];
    if (all.length === 0) return NextResponse.json({ ok: true, scanned: 0, sent: 0 });

    // Cursor is scoped to the recapped week, so each Monday starts from 0.
    const cursorKey = keys.recapCursor(lastWeek.index);
    const cursor = Number((await redis.get<string>(cursorKey)) ?? 0) || 0;
    if (cursor >= all.length) return NextResponse.json({ ok: true, done: true, total: all.length });
    const slice = all.slice(cursor, cursor + (dry ? Math.min(BATCH, 25) : BATCH));

    const t0 = Date.now();
    let processed = 0;
    let sent = 0, quiet = 0, skipped = 0;
    const preview: { address: string; body: string }[] = [];
    for (let i = 0; i < slice.length; i += CONCURRENCY) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      processed = Math.min(slice.length, i + CONCURRENCY);
      await Promise.all(slice.slice(i, i + CONCURRENCY).map(async (addr) => {
        try {
          if (!dry) {
            const fresh = await redis.set(keys.recapSent(lastWeek.index, addr), "1", { nx: true, ex: SENT_TTL_S });
            if (!fresh) { skipped++; return; }
          }

          const a = await fetchWeekActivity(redis, addr, lastWeek, lastWeek.end - 1);
          if (a.claims === 0 && a.dropsHidden === 0 && a.referrals === 0) { quiet++; return; }

          const quests = evaluateQuests(lastWeek.index, a);
          const done = quests.filter((q) => q.done).length;

          const parts: string[] = [];
          if (a.claims > 0) parts.push(`found ${formatG$(a.gFoundWei)} G$ across ${plural(a.claims, "drop", "drops")}`);
          if (a.dropsHidden > 0) parts.push(`hid ${plural(a.dropsHidden, "drop", "drops")}`);
          if (a.referrals > 0) parts.push(`brought in ${plural(a.referrals, "friend", "friends")}`);
          const body = `Last week you ${parts.join(", ")}. ${done}/${quests.length} quests done. New quests are live.`;

          if (dry) { preview.push({ address: addr, body }); return; }
          const r = await sendPush(redis, addr, { title: "Your week on GoodDrops", body, url: "/me", tag: `recap-${lastWeek.index}` });
          if (r.ok) sent++;
        } catch { /* one bad address must not fail the batch */ }
      }));
    }
    if (!dry) await redis.set(cursorKey, String(cursor + processed), { ex: SENT_TTL_S });

    return NextResponse.json({
      ok: true, dry, week: lastWeek.index, weekStart: lastWeek.start,
      scanned: processed, sent, quiet, skipped, total: all.length,
      ...(dry ? { preview } : {}),
    });
  } catch (e) {
    console.error("[cron/recap]", e);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
