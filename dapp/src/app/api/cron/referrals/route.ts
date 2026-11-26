import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { settleInvite, PENDING_TTL_S } from "@/lib/referralLedger";
import { ledgerDeps } from "@/lib/referralDeps";
import { tryRefPayout } from "@/lib/refPayout";
import { tryFirstDropPayout } from "@/lib/firstDropServer";
import { reclaimExpiredChests } from "@/lib/welcomeServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Most invites settled per run; the oldest go first, the rest wait for the next run. */
const BATCH = 400;
const CONCURRENCY = 6;
/** Stop starting new checks after this, to finish inside maxDuration. */
const BUDGET_MS = 45_000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true; // Vercel Cron
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

// GET /api/cron/referrals — every 10 minutes (vercel.json).
// Re-checks every saved invite, so an invitee is counted soon after they qualify
// even if they never open GoodDrops again. Expired invites are cleaned up.
// Also retries any first-drop bonus still owed.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  // One sweep at a time; the lock outlives a run so an overlap can't happen.
  const got = await redis.set(keys.refSweepLock(), "1", { nx: true, ex: 120 });
  if (got !== "OK") return NextResponse.json({ ok: false, reason: "another-run-in-progress" });

  const started = Date.now();
  const tally: Record<string, number> = {};
  try {
    // Rows whose record is long gone (past the stored lifetime) are just dropped.
    const nowS = Math.floor(Date.now() / 1000);
    await redis.zremrangebyscore(keys.refPendingAll(), 0, nowS - PENDING_TTL_S - 8 * 24 * 60 * 60);

    const list = await redis.zrange<string[]>(keys.refPendingAll(), 0, BATCH - 1);
    const deps = ledgerDeps({ payout: false });
    let i = 0;
    const worker = async () => {
      while (i < list.length && Date.now() - started < BUDGET_MS) {
        const invitee = String(list[i++]);
        const r = await settleInvite(redis, invitee, deps);
        const k = r.reason ? `${r.status}:${r.reason}` : r.status;
        tally[k] = (tally[k] ?? 0) + 1;
        // A row whose record expired on its own: nothing left to settle.
        if (r.status === "none") await redis.zrem(keys.refPendingAll(), invitee);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Pay once for everything this run credited.
    if (tally.credited) await tryRefPayout();
    // First-drop bonuses still waiting (wallet was short, or a send failed).
    if ((await redis.zrange<string[]>(keys.firstDropOwed(), 0, 0)).length) await tryFirstDropPayout();
    // Welcome chests that ran out unclaimed go back to the reward wallet. One
    // cheap count when there's nothing to do.
    let chests: { reclaimed: number; reason?: string } | null = null;
    if (await redis.zcount(keys.welcomeLive(), 0, nowS - 60)) {
      chests = await reclaimExpiredChests(redis).catch((e) => { console.error("[cron/referrals] chests", e); return null; });
    }
    return NextResponse.json({ ok: true, checked: Object.values(tally).reduce((a, b) => a + b, 0), of: list.length, tally, chests, ms: Date.now() - started });
  } catch (e) {
    console.error("[cron/referrals]", e);
    return NextResponse.json({ ok: false, error: "sweep failed", tally }, { status: 500 });
  } finally {
    await redis.del(keys.refSweepLock()).catch(() => {});
  }
}
