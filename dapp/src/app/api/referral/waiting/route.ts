import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { REF_ADDR_RE } from "@/lib/referral";
import { PENDING_TTL_S, referralAccountForDisplay } from "@/lib/referralLedger";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { filterVerified } from "@/lib/roots";
import { clientIp } from "@/lib/eventAuth";
import { overLimit } from "@/lib/referralRateLimit";

export const runtime = "nodejs";

/** The next thing a waiting friend needs to do before their invite counts. */
export type WaitingStep = "verify" | "drop";
export interface WaitingFriend { name: string | null; step: WaitingStep; at: number }

const MAX = 50;

// GET /api/referral/waiting?address=0x… → { friends: WaitingFriend[] }
// The people who accepted this wallet's invite but don't count yet, newest
// first, with the step each one still needs. Only their username is shown,
// never their wallet: usernames already appear on the public boards.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !REF_ADDR_RE.test(address)) return NextResponse.json({ error: "valid address required" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ friends: [] });
  if (await overLimit(redis, "ref-waiting", clientIp(req.headers), 120, 600))
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  try {
    const account = await referralAccountForDisplay(redis, address.toLowerCase(), { resolveRoot: resolveIdentityRoot });
    const now = Math.floor(Date.now() / 1000);
    const raw = await redis.zrange<(string | number)[]>(keys.refPendingOf(account), "+inf", now - PENDING_TTL_S,
      { byScore: true, rev: true, withScores: true, offset: 0, count: MAX });
    const rows: { wallet: string; at: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) rows.push({ wallet: String(raw[i]).toLowerCase(), at: Number(raw[i + 1]) });
    if (!rows.length) return NextResponse.json({ friends: [] }, { headers: { "Cache-Control": "private, no-store" } });

    const wallets = rows.map((r) => r.wallet);
    // A verified friend who's still waiting is waiting on their first drop: the
    // moment they claim or hide one, the invite counts.
    const [verified, profiles] = await Promise.all([
      filterVerified(wallets),
      redis.mget<({ username?: string } | null)[]>(...wallets.map((w) => `gd:profile:${w}`)),
    ]);
    const friends: WaitingFriend[] = rows.map((r, i) => ({
      name: profiles[i]?.username ?? null,
      step: verified.has(r.wallet) ? "drop" : "verify",
      at: r.at,
    }));
    return NextResponse.json({ friends }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[referral/waiting]", e);
    return NextResponse.json({ error: "Couldn't load right now" }, { status: 503 });
  }
}
