import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { publicClient } from "@/lib/publicClient";
import { readIdentityStatus } from "@/lib/identity";

export const runtime = "nodejs";
export const maxDuration = 60;

// How many subscribers to scan per run. The cursor rotates so repeated runs cover
// everyone; keep it modest to stay within serverless time limits (Hobby caps
// function duration tightly). Configurable via REVERIFY_BATCH.
const BATCH = Number(process.env.REVERIFY_BATCH ?? 120);
// Higher concurrency = a full daily scan finishes well inside the time limit.
const CONCURRENCY = 12;
// Don't nag: at most one reminder per subscriber in this window.
const REMIND_COOLDOWN_S = 3 * 24 * 60 * 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — no open reminder endpoint
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;          // Vercel Cron style
  if (req.headers.get("x-cron-secret") === secret) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

// Decide whether a wallet should get a re-verify nudge, and with what message.
function reminderFor(s: Awaited<ReturnType<typeof readIdentityStatus>>): { title: string; body: string } | null {
  if (s.state === "lapsed") {
    return {
      title: "Re-verify to keep hunting 🔓",
      body:  "Your GoodDollar check lapsed — a quick face re-scan restores your access to drops.",
    };
  }
  if (s.state === "verified") {
    // Probation = the recurring 3-day rung; warn on the last day. Long rung: last 3 days.
    const urgent = s.isProbation ? s.daysLeft <= 1 : s.daysLeft <= 3;
    if (urgent) {
      return {
        title: "Your verification is about to expire ⏳",
        body:  `Re-verify in the next ${Math.max(1, s.daysLeft)} day${s.daysLeft === 1 ? "" : "s"} so you don't lose access to drops.`,
      };
    }
  }
  return null;
}

// GET /api/cron/reverify — scheduled job (Vercel Cron). Scans a rotating batch of
// push subscribers and nudges those whose GoodDollar verification lapsed or is
// about to. Safe to call repeatedly; each subscriber is rate-limited.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: false, reason: "No storage" });

  const origin = req.nextUrl.origin;
  const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? "";

  try {
    const all = (await redis.smembers(keys.subscribersIndex())) ?? [];
    if (all.length === 0) return NextResponse.json({ ok: true, scanned: 0, reminded: 0 });

    // Rotate through the list across runs so a large base is fully covered.
    const cursor = Number((await redis.get<string>(keys.reverifyCursor())) ?? 0) || 0;
    const start  = cursor % all.length;
    const slice  = all.length <= BATCH
      ? all
      : Array.from({ length: BATCH }, (_, i) => all[(start + i) % all.length]);
    await redis.set(keys.reverifyCursor(), String((start + slice.length) % all.length));

    let reminded = 0;

    // Small concurrency pool — bounded RPC pressure, bounded wall-clock.
    for (let i = 0; i < slice.length; i += CONCURRENCY) {
      const chunk = slice.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (addr) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const status = await readIdentityStatus(publicClient as any, addr);
          const msg = reminderFor(status);
          if (!msg) return;
          // Rate-limit: NX set fails if we reminded them recently.
          const fresh = await redis.set(keys.reverifyReminded(addr), "1", { nx: true, ex: REMIND_COOLDOWN_S });
          if (!fresh) return;
          await fetch(`${origin}/api/push/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
            body: JSON.stringify({ to: addr, title: msg.title, body: msg.body, url: "/", tag: "reverify" }),
          });
          reminded++;
        } catch { /* one bad address must not fail the batch */ }
      }));
    }

    return NextResponse.json({ ok: true, scanned: slice.length, reminded, total: all.length });
  } catch (e) {
    console.error("[cron/reverify]", e);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
