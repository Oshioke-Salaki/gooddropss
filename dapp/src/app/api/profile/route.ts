import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { verifyMessage } from "viem";
import { resolveIdentityRoot } from "@/lib/identityRoot";

// Fail fast on network blips — the default (5 retries, exponential backoff)
// makes requests hang for 20–30s when DNS/network hiccups.
const redis = Redis.fromEnv({ retry: { retries: 1, backoff: () => 300 } });

const USERNAME_RE  = /^[a-zA-Z0-9_-]{3,24}$/;
const RESERVED     = new Set(["admin","gooddrops","gooddollar","celo","support","system"]);
// Generous window: the timestamp is compared against the CLIENT's clock, and phones
// are routinely minutes-to-hours off. For a cosmetic username, the timestamp is only
// anti-replay — and replaying a claim signature is harmless (it re-claims the same
// name for the same wallet, which the signature already proves ownership of). So a
// tight window just breaks real users with skewed clocks for no security gain.
const SIG_WINDOW   = 24 * 60 * 60 * 1000; // 24 hours

// ── GET /api/profile?address=0x... ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  try {
    // Usernames are IDENTITY-scoped: resolve the wallet to its GoodDollar root so a
    // name set on any of a person's linked wallets is found from any of them. Self-
    // verified / unverified wallets resolve to themselves — unchanged behaviour.
    const root = await resolveIdentityRoot(address);
    let raw = await redis.get<{ username: string; createdAt: number }>(`gd:profile:${root}`);
    // Legacy fallback: names set on a LINKED wallet before identity-scoping were
    // keyed by that wallet. Only checked for linked wallets (root != self) and only
    // on a miss, so self-verified users still do a single read.
    if (!raw && root !== address) {
      raw = await redis.get<{ username: string; createdAt: number }>(`gd:profile:${address}`);
    }
    if (!raw) return NextResponse.json(null);
    return NextResponse.json(raw);
  } catch (e) {
    // Redis unreachable — profiles are cosmetic, degrade to "no username" instead of 500
    console.error("[profile/get]", e);
    return NextResponse.json(null);
  }
}

// ── POST /api/profile ──────────────────────────────────────────────────────
// Body: { address, username, signature, timestamp }
export async function POST(req: NextRequest) {
  let body: { address?: string; username?: string; signature?: string; timestamp?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }

  const { address, username, signature, timestamp } = body;

  if (!address || !username || !signature || !timestamp) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Validate username format
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ error: "Username must be 3–24 characters: letters, numbers, _ or -" }, { status: 400 });
  }
  if (RESERVED.has(username.toLowerCase())) {
    return NextResponse.json({ error: "That username is reserved" }, { status: 400 });
  }

  // Validate timestamp freshness
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW) {
    return NextResponse.json({ error: "Signature expired — try again" }, { status: 400 });
  }

  // Verify wallet signature
  const message = `GoodDrops: claim username "${username}" at ${timestamp}`;
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  // Store under the signer's GoodDollar identity ROOT, so the name follows the
  // person across every linked wallet. The signature proves ownership of `address`;
  // its root is resolved on-chain, so a user can only ever affect their own identity.
  const root        = await resolveIdentityRoot(address.toLowerCase());
  const profileKey  = `gd:profile:${root}`;
  const usernameLow = username.toLowerCase();
  const nameKey     = `gd:username:${usernameLow}`;

  // Uniqueness — but allow re-claiming your OWN name. Resolve the stored value's
  // identity root so a legacy wallet-keyed reservation still recognises its owner
  // (new reservations store the root, which resolves to itself).
  const existing = await redis.get<string>(nameKey);
  if (existing && (await resolveIdentityRoot(existing.toLowerCase())) !== root) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  // Release the old username if the user is changing it.
  const oldProfile = await redis.get<{ username: string }>(profileKey);
  if (oldProfile?.username && oldProfile.username.toLowerCase() !== usernameLow) {
    await redis.del(`gd:username:${oldProfile.username.toLowerCase()}`);
  }

  // Persist (identity-scoped).
  await redis.set(nameKey, root);
  await redis.set(profileKey, { username, createdAt: Date.now() });

  return NextResponse.json({ username });
}
