import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient, createWalletClient, http,
  keccak256, encodePacked, formatEther, parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { badgeTypeId } from "@/lib/badges";
import { GOOD_DROPS_BADGES_ADDRESS, GOOD_DROPS_BADGES_ABI } from "@/lib/contracts";
import { normalizePk } from "@/lib/pk";

export const runtime = "nodejs";
export const maxDuration = 45;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SIG_TTL_S = 15 * 60;
// Anti-drain (same philosophy as the gas faucet): each (person, badge) can only
// ever mint once, but bound total relayer gas anyway.
const MINT_MAX_PER_DAY = Number(process.env.BADGE_MINT_MAX_PER_DAY ?? 300); // global circuit breaker
const IP_MINT_MAX_PER_DAY = 15;

const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
}

// POST /api/badges/mint  Body: { address, badgeId }
// Mints an EARNED badge on-chain to the caller's wallet. The server signs the
// authorization (only for badges the person actually earned), the relayer submits
// and pays the gas — so it's free for the hunter. Soulbound + one-per-wallet is
// enforced by the contract itself as the final backstop.
export async function POST(req: NextRequest) {
  const signerKey  = normalizePk(process.env.BADGE_SIGNER_KEY);
  const relayerKey = normalizePk(process.env.BADGE_RELAYER_KEY ?? process.env.GAS_FAUCET_KEY);
  if (!signerKey || !relayerKey) {
    return NextResponse.json({ error: "Minting not configured" }, { status: 503 });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let address: string, badgeId: string;
  try {
    const body = await req.json();
    address = String(body.address ?? "");
    badgeId = String(body.badgeId ?? "");
  } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(badgeId)) return NextResponse.json({ error: "Invalid badge" }, { status: 400 });
  address = address.toLowerCase();

  const root = (await resolveIdentityRoot(address)).toLowerCase();

  // ── Must have actually EARNED it (identity-scoped ledger) ──────────────────
  const earned = await redis.zscore(keys.badgesOf(root), badgeId);
  if (earned === null || earned === undefined) {
    return NextResponse.json({ error: "You haven't earned that badge yet." }, { status: 403 });
  }

  // Already minted by this identity? (fast path; contract is the real backstop)
  if (await redis.sismember(keys.badgeMinted(root), badgeId)) {
    return NextResponse.json({ ok: true, already: true });
  }

  // ── Per-(root,badge) lock guards the whole check-then-send ────────────────
  const lock = await redis.set(keys.badgeMintLock(root, badgeId), "1", { nx: true, ex: 90 });
  if (lock === null) return NextResponse.json({ ok: false, reason: "in_progress" });

  const today = new Date().toISOString().slice(0, 10);
  const dayKey = `gd:badge:mintday:${today}`;
  const ip = clientIp(req);
  const ipKey = `gd:badge:mintip:${ip}:${today}`;

  try {
    const typeId = badgeTypeId(badgeId);

    // Backstop: if the chain already has it, record + short-circuit (no wasted tx).
    const onChain = await publicClient.readContract({
      address: GOOD_DROPS_BADGES_ADDRESS, abi: GOOD_DROPS_BADGES_ABI,
      functionName: "hasBadge", args: [address as `0x${string}`, typeId],
    });
    if (onChain) {
      await redis.sadd(keys.badgeMinted(root), badgeId);
      return NextResponse.json({ ok: true, already: true });
    }

    // Circuit breakers.
    const daily = Number((await redis.get(dayKey)) ?? 0);
    if (daily >= MINT_MAX_PER_DAY) return NextResponse.json({ ok: false, reason: "resting" }, { status: 429 });
    const ipCount = Number((await redis.get(ipKey)) ?? 0);
    if (ipCount >= IP_MINT_MAX_PER_DAY) return NextResponse.json({ ok: false, reason: "ip_cap" }, { status: 429 });

    // Relayer solvency.
    const relayer = privateKeyToAccount(relayerKey);
    const bal = await publicClient.getBalance({ address: relayer.address });
    if (bal < parseEther("0.05")) {
      console.error("[badges/mint] RELAYER LOW:", formatEther(bal), "CELO");
      return NextResponse.json({ ok: false, reason: "relayer_empty" }, { status: 503 });
    }

    // ── Sign the mint authorization (matches GoodDropsBadges.mint digest) ────
    const deadline = BigInt(Math.floor(Date.now() / 1000) + SIG_TTL_S);
    const digest = keccak256(encodePacked(
      ["string", "uint256", "address", "address", "uint256", "uint256"],
      ["GOODDROPS_BADGE", BigInt(celo.id), GOOD_DROPS_BADGES_ADDRESS, address as `0x${string}`, typeId, deadline],
    ));
    const signer = privateKeyToAccount(signerKey);
    const sig = await signer.signMessage({ message: { raw: digest } });

    // Count the attempt BEFORE sending (fail-closed), roll back on send failure.
    await Promise.all([
      redis.incr(dayKey).then((n) => (n === 1 ? redis.expire(dayKey, 48 * 3600) : null)),
      redis.incr(ipKey).then((n) => (n === 1 ? redis.expire(ipKey, 48 * 3600) : null)),
    ]);

    let tx: `0x${string}`;
    try {
      const wallet = createWalletClient({ account: relayer, chain: celo, transport: http("https://forno.celo.org") });
      tx = await wallet.writeContract({
        address: GOOD_DROPS_BADGES_ADDRESS, abi: GOOD_DROPS_BADGES_ABI,
        functionName: "mint", args: [address as `0x${string}`, typeId, deadline, sig],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    } catch (e) {
      await Promise.all([redis.decr(dayKey).catch(() => {}), redis.decr(ipKey).catch(() => {})]);
      console.error("[badges/mint] tx failed", e);
      return NextResponse.json({ ok: false, reason: "mint_failed" }, { status: 502 });
    }

    await redis.sadd(keys.badgeMinted(root), badgeId);
    redis.lpush("gd:badge:mintlog", JSON.stringify({ ts: Math.floor(Date.now() / 1000), address, root, badgeId, tx }))
      .then(() => redis.ltrim("gd:badge:mintlog", 0, 999)).catch(() => {});

    return NextResponse.json({ ok: true, tx });
  } catch (e) {
    console.error("[badges/mint]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  } finally {
    redis.del(keys.badgeMintLock(root, badgeId)).catch(() => {});
  }
}
