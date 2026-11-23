import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { resolveIdentityRootStrict, isVerifiedHuman } from "@/lib/identityRoot";
import { fetchHasActivity } from "@/lib/subgraph";
import { getCompConfig } from "@/lib/competition";
import { creditReferral, referralAccountFor } from "@/lib/referralLedger";
import { ledgerDeps } from "@/lib/referralDeps";

export const runtime = "nodejs";
// Room for the inline referral payout to broadcast a transfer. It skips the
// receipt wait, so this is headroom rather than an expected duration.
export const maxDuration = 30;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// POST /api/comp/credit  (admin) — manually record a referral the automatic flow
// missed (e.g. during the Redis outage). Enforces the SAME rules as the auto path
// so a recovered referral is exactly as legitimate as an organic one:
//   • invitee is a verified GoodDollar human
//   • invitee has actually done a task (claimed or created a drop)
//   • invitee isn't already referred by someone else (first-referrer-wins)
// The restored referral link earns the competition's double-count bonus when the
// invitee claims one of the referrer's drops. Body: { referrer, invitee } — each a
// @username or a 0x address.
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

  let referrerRoot: string, inviteeRoot: string, account: string;
  try {
    [referrerRoot, inviteeRoot] = await Promise.all([resolveIdentityRootStrict(refAddr), resolveIdentityRootStrict(invAddr)]);
    account = await referralAccountFor(redis, refAddr, { resolveRoot: resolveIdentityRootStrict });
  } catch {
    return NextResponse.json({ error: "Couldn't read GoodDollar identities just now. Try again in a minute." }, { status: 503 });
  }
  if ([referrerRoot, account, refAddr].some((k) => k === inviteeRoot || k === invAddr))
    return NextResponse.json({ error: "A person can't refer themselves." }, { status: 400 });

  // Same anti-cheat bar as the automatic credit.
  if (!(await isVerifiedHuman(invAddr))) {
    return NextResponse.json({ error: `@${invInput} isn't a verified GoodDollar human yet — can't credit.` }, { status: 409 });
  }
  let active: boolean;
  try { active = await fetchHasActivity(invAddr); }
  catch { return NextResponse.json({ error: "Couldn't reach the drop index just now. Try again in a minute." }, { status: 503 }); }
  if (!active) {
    return NextResponse.json({ error: `@${invInput} hasn't claimed or created a drop yet — doesn't qualify.` }, { status: 409 });
  }

  const existing = await redis.get<string>(keys.referredBy(inviteeRoot));
  if (existing && existing.toLowerCase() !== account) {
    return NextResponse.json({ error: `@${invInput} was already referred by someone else — first referrer wins.` }, { status: 409 });
  }

  // Credit — idempotent, through the same ledger as the automatic path. For the
  // referral competition the credit timestamp also decides first-come-first-served
  // pot ordering, so a recovery is stamped at "now" (clamped into the points
  // competition's window) — it never jumps ahead of referrals that happened earlier.
  const cfg = await getCompConfig(redis);
  const nowSec = Math.floor(Date.now() / 1000);
  const scoreTs = Math.min(Math.max(nowSec, cfg.startsAt), Math.max(cfg.startsAt, cfg.endsAt - 1));

  const res = await creditReferral(redis, { inviteeRoot, account, referrerWallet: refAddr, referrerRoot, at: scoreTs, payoutWallet: "keep" }, ledgerDeps());
  if (res.status === "rejected") {
    return NextResponse.json({ error: `@${invInput} was already referred by someone else — first referrer wins.` }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    message: existing ? `Already linked — re-recorded @${invInput} → @${refInput}.` : `Credited @${invInput} → @${refInput}.`,
    referrerRoot: account,
    inviteeRoot,
    newReferral: res.status === "credited",
  });
}
