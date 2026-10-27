import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { Hex } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { isVerifiedHuman, resolveIdentityRoot } from "@/lib/identityRoot";
import { memo } from "@/lib/serverCache";
import { decide, isCelo } from "@/lib/sponsorPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/sponsor/approve?key=SECRET
//
// Alchemy's Gas Manager calls this before sponsoring each user operation and
// sponsors only on { approved: true }. The policy is set to NOT sponsor on
// error or timeout, so anything unexpected here means "no", and the app falls
// back to the user's own gas (see lib/sponsor). Always answers 200 + JSON.
//
// Only GoodDollar-verified people, only GoodDrops actions (lib/sponsorPolicy).
// Limits, per UTC day:
//   per person, by identity root (all their linked wallets)   SPONSOR_PER_PERSON  (40)
//   everyone together                                          SPONSOR_MAX_PER_DAY (2000)
// Alchemy may ask about the same operation more than once (estimate, then
// send); each sender+nonce is counted once.

const PER_PERSON  = Number(process.env.SPONSOR_PER_PERSON ?? 40);
const MAX_PER_DAY = Number(process.env.SPONSOR_MAX_PER_DAY ?? 2000);
const DAY_S = 36 * 3600; // counters outlive the day they count, then expire

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const no = (reason: string, sender?: string) => {
  console.warn("[sponsor] rejected", reason, sender ?? "");
  return NextResponse.json({ approved: false });
};

/** Field names only (never values), so a payload format change is diagnosable from logs. */
function shape(body: Record<string, unknown>, op: Record<string, unknown> | undefined): string {
  return `${Object.keys(body).join(",")}|op:${op ? Object.keys(op).join(",") : "none"}`;
}

function secretOk(given: string | null): boolean {
  const want = process.env.SPONSOR_WEBHOOK_SECRET ?? "";
  if (!want || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretOk(req.nextUrl.searchParams.get("key"))) return no("bad_secret");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return no("bad_json"); }

  const policy = process.env.NEXT_PUBLIC_ALCHEMY_POLICY_ID;
  if (policy && body.policyId !== undefined && body.policyId !== policy) return no("wrong_policy");
  if (!isCelo(body.chainId)) return no("wrong_chain");

  const op = (body.userOperation ?? body.userOp) as Record<string, unknown> | undefined;
  const sender = typeof op?.sender === "string" ? op.sender.toLowerCase() : "";
  const nonce = typeof op?.nonce === "string" || typeof op?.nonce === "number" ? String(op.nonce) : "";
  if (!ADDR_RE.test(sender) || !nonce) return no(`bad_op keys=${shape(body, op)}`);

  // Verified status rarely changes; cache it so the webhook stays fast.
  let verified = false;
  try {
    verified = await memo(`sp:ver:${sender}`, 10 * 60_000, () => isVerifiedHuman(sender));
  } catch { verified = false; } // RPC trouble: treat as unverified, not as a pass

  const d = decide(op?.callData as Hex | undefined, verified);
  if (!d.ok) return no(d.reason === "unreadable" ? `unreadable keys=${shape(body, op)}` : d.reason, sender);

  const redis = getRedis();
  if (!redis) return no("storage_unavailable", sender);

  try {
    // Same operation asked about again: already counted and approved.
    const first = await redis.set(keys.sponsorOp(sender, nonce), "1", { nx: true, ex: 3600 });
    if (first === null) return NextResponse.json({ approved: true });

    const today = new Date().toISOString().slice(0, 10);
    const who = (await memo(`sp:root:${sender}`, 60 * 60_000, () => resolveIdentityRoot(sender))).toLowerCase();
    const limits: [string, number][] = [
      [keys.sponsorDay(today), MAX_PER_DAY],
      [keys.sponsorWho(who, today), PER_PERSON],
    ];

    // Count first, then check, so concurrent requests can't both slip under.
    const counts = await Promise.all(limits.map(async ([k]) => {
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, DAY_S);
      return n;
    }));
    const over = counts.findIndex((n, i) => n > limits[i][1]);
    if (over !== -1) {
      await Promise.all(limits.map(([k]) => redis.decr(k).catch(() => {})));
      await redis.del(keys.sponsorOp(sender, nonce)).catch(() => {});
      return no(over === 0 ? "daily_cap" : "person_cap", sender);
    }
    return NextResponse.json({ approved: true });
  } catch (e) {
    console.error("[sponsor] webhook error", e);
    return no("error", sender);
  }
}
