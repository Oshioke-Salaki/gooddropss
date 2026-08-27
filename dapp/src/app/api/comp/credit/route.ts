import { NextRequest, NextResponse, after } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { resolveIdentityRoot, isVerifiedHuman } from "@/lib/identityRoot";
import { fetchHasActivity } from "@/lib/subgraph";
import { getCompConfig } from "@/lib/competition";
import { runCompPayout } from "@/lib/compPayout";

export const runtime = "nodejs";
export const maxDuration = 60;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// POST /api/comp/credit  (admin) — manually record a referral the automatic flow
// missed (e.g. during the Redis outage). Enforces the SAME rules as the auto path
// so a recovered referral is exactly as legitimate as an organic one:
//   • invitee is a verified GoodDollar human
//   • invitee has actually done a task (claimed or created a drop)
//   • invitee isn't already referred by someone else (first-referrer-wins)
// Body: { referrer, invitee } — each a @username or a 0x address.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const b = await req.json().catch(() => ({}));
  const refInput = String(b.referrer ?? "").trim().replace(/^@/, "");
  const invInput = String(b.invitee ?? "").trim().replace(/^@/, "");
  if (!refInput || !invInput) return NextResponse.json({ error: "referrer and invitee are required" }, { status: 400 });

  const resolveInput = async (input: string): Promise<string | null> => {
    if (ADDR_RE.test(input)) return input.toLowerCase();
    const stored = await redis.get<string>(`gd:username:${input.toLowerCase()}`);
    return stored ? stored.toLowerCase() : null;
  };

  const refAddr = await resolveInput(refInput);
  const invAddr = await resolveInput(invInput);
  if (!refAddr) return NextResponse.json({ error: `Referrer "${refInput}" not found (unknown username/address).` }, { status: 404 });
  if (!invAddr) return NextResponse.json({ error: `Invitee "${invInput}" not found (unknown username/address).` }, { status: 404 });

  const [referrerRoot, inviteeRoot] = await Promise.all([resolveIdentityRoot(refAddr), resolveIdentityRoot(invAddr)]);
  if (referrerRoot === inviteeRoot) return NextResponse.json({ error: "A person can't refer themselves." }, { status: 400 });

  // Same anti-cheat bar as the automatic credit.
  if (!(await isVerifiedHuman(invAddr))) {
    return NextResponse.json({ error: `@${invInput} isn't a verified GoodDollar human yet — can't credit.` }, { status: 409 });
  }
  if (!(await fetchHasActivity(invAddr))) {
    return NextResponse.json({ error: `@${invInput} hasn't claimed or created a drop yet — doesn't qualify.` }, { status: 409 });
  }

  const existing = await redis.get<string>(keys.referredBy(inviteeRoot));
  if (existing && existing.toLowerCase() !== referrerRoot) {
    return NextResponse.json({ error: `@${invInput} was already referred by someone else — first referrer wins.` }, { status: 409 });
  }

  // Credit — idempotent. Backdate the score into the competition window so a
  // recovery still counts even if you run it after the deadline.
  const cfg = await getCompConfig(redis);
  const nowSec = Math.floor(Date.now() / 1000);
  const scoreTs = Math.min(Math.max(nowSec, cfg.startsAt), Math.max(cfg.startsAt, cfg.endsAt - 1));

  await redis.set(keys.referredBy(inviteeRoot), referrerRoot);
  const added = await redis.sadd(keys.referralsOf(referrerRoot), inviteeRoot);
  await redis.zadd(keys.referralCredited(referrerRoot), { score: scoreTs, member: inviteeRoot });
  if (added) await redis.zincrby(keys.referralLeaders(), 1, referrerRoot);
  const wallet = await redis.get<string>(keys.compPayoutWallet(referrerRoot));
  if (!wallet) await redis.set(keys.compPayoutWallet(referrerRoot), refAddr);
  await redis.sadd(keys.compParticipants(), referrerRoot);

  // Pay promptly if this pushes the referrer past the threshold.
  after(() => runCompPayout().catch(() => {}));

  return NextResponse.json({
    ok: true,
    message: existing ? `Already linked — re-recorded @${invInput} → @${refInput}.` : `Credited @${invInput} → @${refInput}.`,
    referrerRoot,
    inviteeRoot,
    newReferral: added === 1,
  });
}
