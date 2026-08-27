import { NextRequest, NextResponse, after } from "next/server";
import { recoverMessageAddress } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot, isVerifiedHuman } from "@/lib/identityRoot";
import { referralAcceptMessage, REF_ADDR_RE } from "@/lib/referral";
import { fetchHasActivity } from "@/lib/subgraph";
import { getCompConfig, inCompWindow } from "@/lib/competition";
import { runCompPayout } from "@/lib/compPayout";

export const runtime = "nodejs";
// The credit response returns fast; the opportunistic payout sweep runs in after()
// and needs room to broadcast + confirm a transfer, so widen the invocation budget.
export const maxDuration = 60;

const SIG_WINDOW = 24 * 60 * 60 * 1000;

// GET /api/referral?address=0x…          → { count, referredBy }
// GET /api/referral?leaders=1            → { leaders: [{ root, count }] }
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ count: 0, referredBy: null, leaders: [] });

  try {
    if (req.nextUrl.searchParams.get("leaders")) {
      // Top recruiters (root → count). withScores returns [member, score, …].
      const raw = await redis.zrange<(string | number)[]>(keys.referralLeaders(), 0, 9, {
        rev: true, withScores: true,
      });
      const leaders: { root: string; count: number }[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        leaders.push({ root: String(raw[i]), count: Number(raw[i + 1]) });
      }
      return NextResponse.json({ leaders });
    }

    const address = req.nextUrl.searchParams.get("address");
    if (!address || !REF_ADDR_RE.test(address))
      return NextResponse.json({ count: 0, referredBy: null });

    const root = await resolveIdentityRoot(address);
    const [count, referredBy] = await Promise.all([
      redis.scard(keys.referralsOf(root)),
      redis.get<string>(keys.referredBy(root)),
    ]);
    return NextResponse.json({ count: count ?? 0, referredBy: referredBy ?? null });
  } catch (e) {
    console.error("[referral/get]", e);
    return NextResponse.json({ count: 0, referredBy: null });
  }
}

// POST /api/referral — attribute the SIGNER (invitee) to a referrer.
// Body: { referrer, signature, timestamp }. First referrer wins, forever.
export async function POST(req: NextRequest) {
  let body: { referrer?: string; signature?: string; timestamp?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { referrer, signature, timestamp } = body;
  if (!referrer || !REF_ADDR_RE.test(referrer))
    return NextResponse.json({ error: "Invalid referrer" }, { status: 400 });
  if (!signature || typeof signature !== "string" || !signature.startsWith("0x"))
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
    return NextResponse.json({ error: "Missing timestamp" }, { status: 400 });
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW)
    return NextResponse.json({ error: "Signature expired" }, { status: 400 });

  // Recover the invitee (the signer).
  let invitee: string;
  try {
    invitee = (await recoverMessageAddress({
      message: referralAcceptMessage(referrer, timestamp),
      signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  // Only real (verified) humans can be credited — Sybil resistance.
  if (!(await isVerifiedHuman(invitee)))
    return NextResponse.json({ error: "Verify with GoodDollar first." }, { status: 403 });

  // And they must have actually done a task (claimed or created a drop) — we credit
  // active humans, not bare sign-ups. The client only calls after a task; this is the
  // server-side backstop, and the exact bar the referral competition pays out on.
  if (!(await fetchHasActivity(invitee)))
    return NextResponse.json({ error: "Do a task first — claim or create a drop.", needsTask: true }, { status: 409 });

  const [inviteeRoot, referrerRoot] = await Promise.all([
    resolveIdentityRoot(invitee),
    resolveIdentityRoot(referrer),
  ]);

  // Can't refer yourself (or another wallet of the same identity).
  if (inviteeRoot === referrerRoot)
    return NextResponse.json({ error: "You can't refer yourself." }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    // First referrer wins — attribution is immutable once set.
    const existing = await redis.get<string>(keys.referredBy(inviteeRoot));
    if (existing) return NextResponse.json({ ok: true, already: true, referrer: existing });

    await redis.set(keys.referredBy(inviteeRoot), referrerRoot);
    const added = await redis.sadd(keys.referralsOf(referrerRoot), inviteeRoot);
    // Keep the all-time leaderboard in step, and stamp WHEN it was credited so the
    // time-boxed competition can window it — only for a genuinely new member.
    if (added) {
      const nowSec = Math.floor(Date.now() / 1000);
      await redis.zincrby(keys.referralLeaders(), 1, referrerRoot);
      await redis.zadd(keys.referralCredited(referrerRoot), { score: nowSec, member: inviteeRoot });
      // Remember the wallet this referrer is actively using (the one their invite
      // link was made from) — competition payouts go there, not to the id root.
      await redis.set(keys.compPayoutWallet(referrerRoot), referrer.toLowerCase());
      // If it lands inside the live competition window, enroll the referrer so the
      // payout worker and leaderboard can enumerate participants cheaply.
      try {
        const cfg = await getCompConfig(redis);
        if (inCompWindow(cfg, nowSec)) {
          await redis.sadd(keys.compParticipants(), referrerRoot);
          // Only run the (heavier) payout sweep once this referrer can actually be
          // owed — i.e. they've reached the threshold. Below that there's nothing to
          // pay, so we skip it to avoid needless worker runs on every early referral.
          const count = await redis.zcount(keys.referralCredited(referrerRoot), cfg.startsAt, cfg.endsAt);
          if (count >= cfg.threshold) after(() => runCompPayout().catch(() => {}));
        }
      } catch { /* enrollment is best-effort; attribution is already saved */ }
    }

    return NextResponse.json({ ok: true, referrer: referrerRoot });
  } catch (e) {
    console.error("[referral/post]", e);
    return NextResponse.json({ error: "Could not save referral" }, { status: 500 });
  }
}
