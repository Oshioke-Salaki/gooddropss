import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { referralAcceptMessage, REF_ADDR_RE, type InviteResult } from "@/lib/referral";
import { offerInvite, settleInvite, readPending, referrerStats, NEW_MEMBER_WINDOW_S } from "@/lib/referralLedger";
import { ledgerDeps } from "@/lib/referralDeps";
import { fetchFirstActivityAt } from "@/lib/subgraph";
import { clientIp } from "@/lib/eventAuth";
import { overLimit } from "@/lib/referralRateLimit";

export const runtime = "nodejs";
// Room for the inline referral payout to broadcast a transfer. It skips the
// receipt wait, so this is headroom rather than an expected duration.
export const maxDuration = 30;

/** How old a signed acceptance may be when it reaches us. */
const SIG_WINDOW_MS = 24 * 60 * 60 * 1000;
const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/referral?address=0x…
//   → { count, waiting, referredBy, invite, canBeInvited }
//     count/waiting: people this wallet's owner has brought in / who are on the way.
//     invite:        this wallet's OWN invite, if it has one (waiting or counted).
//     canBeInvited:  new enough that an invite could still count (null = unknown).
// GET /api/referral?leaders=1 → { leaders: [{ root, count }] }
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ count: 0, waiting: 0, referredBy: null, invite: { status: "none" }, canBeInvited: null, leaders: [] });

  try {
    if (req.nextUrl.searchParams.get("leaders")) {
      // Top recruiters (account → count). withScores returns [member, score, …].
      const raw = await redis.zrange<(string | number)[]>(keys.referralLeaders(), 0, 9, { rev: true, withScores: true });
      const leaders: { root: string; count: number }[] = [];
      for (let i = 0; i < raw.length; i += 2) leaders.push({ root: String(raw[i]), count: Number(raw[i + 1]) });
      return NextResponse.json({ leaders });
    }

    const address = req.nextUrl.searchParams.get("address");
    if (!address || !REF_ADDR_RE.test(address)) return NextResponse.json({ error: "valid address required" }, { status: 400 });
    const addr = address.toLowerCase();

    const root = await resolveIdentityRoot(addr);
    const [stats, referredByRaw, pending] = await Promise.all([
      referrerStats(redis, addr, { resolveRoot: resolveIdentityRoot }),
      redis.get<string>(keys.referredBy(root)),
      readPending(redis, addr),
    ]);
    const referredBy = referredByRaw ? referredByRaw.toLowerCase() : null;

    const invite: InviteResult = referredBy
      ? { status: "already", referrer: referredBy }
      : pending ? { status: "waiting", referrer: pending.referrer } : { status: "none" };

    // Only worth asking when there's no invite yet: drives "Who invited you?".
    let canBeInvited: boolean | null = null;
    if (invite.status === "none") {
      try {
        const first = await fetchFirstActivityAt([addr, root]);
        canBeInvited = first === null || Math.floor(Date.now() / 1000) - first <= NEW_MEMBER_WINDOW_S;
      } catch { canBeInvited = null; }
    } else {
      canBeInvited = false;
    }

    return NextResponse.json(
      { count: stats.count, waiting: stats.waiting, referredBy, invite, canBeInvited },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("[referral/get]", e);
    return NextResponse.json({ error: "Couldn't load invites right now" }, { status: 503 });
  }
}

// POST /api/referral — the SIGNER (invitee) accepts a referrer's invite.
// Body: { referrer, signature, timestamp }.
// Saves the invite (first one wins) and counts it right away if it already
// qualifies; otherwise it's counted automatically once it does.
// → InviteResult: { status, reason?, referrer? }
export async function POST(req: NextRequest) {
  let body: { referrer?: unknown; signature?: unknown; timestamp?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { referrer, signature, timestamp } = body;
  if (typeof referrer !== "string" || !REF_ADDR_RE.test(referrer))
    return NextResponse.json({ error: "Invalid referrer" }, { status: 400 });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 1000)
    return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 400 });
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
    return NextResponse.json({ error: "Missing timestamp" }, { status: 400 });
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW_MS)
    return NextResponse.json({ error: "That took too long. Please try again." }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  if (await overLimit(redis, "offer", clientIp(req.headers), 120, 600))
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });

  // Recover the invitee (the signer).
  let invitee: string;
  try {
    invitee = (await recoverMessageAddress({
      message: referralAcceptMessage(referrer, timestamp),
      signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 });
  }

  if (invitee === referrer.toLowerCase()) {
    return NextResponse.json({ status: "rejected", reason: "self" } satisfies InviteResult);
  }

  try {
    const deps = ledgerDeps();
    await offerInvite(redis, invitee, referrer, deps);
    const result = await settleInvite(redis, invitee, deps);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (e) {
    console.error("[referral/post]", e);
    return NextResponse.json({ error: "Could not save your invite. Please try again." }, { status: 500 });
  }
}
