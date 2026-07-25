import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { getRedis, keys } from "@/lib/redis";
import { isVerifiedHuman, resolveIdentityRoot } from "@/lib/identityRoot";

export const runtime = "nodejs";
export const maxDuration = 30;

// ── Anti-drain design ─────────────────────────────────────────────────────────
// A faucet is a standing invitation to be drained, so every send passes SEVEN
// independent gates:
//
//   1. Verified human only — the target must be GoodDollar face-verified. Farming
//      the faucet requires farming face verifications, which is expensive.
//   2. On-chain balance gate — we check the target's ACTUAL CELO balance and only
//      send if it's below the threshold. "Please top me up" with a full wallet
//      is a no-op; you can't accumulate.
//   3. Identity-root cooldown — one top-up per person (all linked wallets!) per
//      cooldown window, so wallet-hopping doesn't reset anything.
//   4. Rolling 30-day cap per identity root.
//   5. Global daily circuit breaker — if the whole faucet exceeds N sends in a
//      day, it pauses until tomorrow. A drain attempt is capped at one day of
//      budget no matter what.
//   6. Per-IP daily cap — cheap secondary brake on scripted loops.
//   7. Per-root send lock — concurrent requests can't double-send.
//
// No signature is required, deliberately: a top-up is a GIFT to the target
// address (nothing can be stolen), and every limit above is keyed to the
// TARGET's identity/balance — so calling it for someone else's wallet spends
// *their* allowance, never more. There is no amplification path.
//
// Counters are marked BEFORE the transfer and rolled back on failure, so a
// crash can never leave a loophole open (fail-closed).

const TOPUP_CELO      = process.env.GAS_TOPUP_AMOUNT_CELO ?? "0.5"; // ~500+ txs on Celo
const THRESHOLD_CELO  = "0.01";     // only top up below this balance
const COOLDOWN_S      = 72 * 3600;  // one top-up per person per 3 days
const MONTHLY_CAP     = 3;          // per identity root per rolling 30 days
const DAILY_CAP       = Number(process.env.GAS_TOPUP_MAX_PER_DAY ?? 100); // global circuit breaker
const IP_DAILY_CAP    = 5;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown"
  );
}

// POST /api/gas-topup  Body: { address }
// 200 {ok:true, tx} | 200 {ok:false, reason} (benign skip) | 4xx on abuse gates
export async function POST(req: NextRequest) {
  const faucetKey = process.env.GAS_FAUCET_KEY as `0x${string}` | undefined;
  if (!faucetKey) return NextResponse.json({ ok: false, reason: "not_configured" });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: false, reason: "storage_unavailable" });

  let address: string;
  try {
    const body = await req.json();
    address = String(body.address ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!ADDR_RE.test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  address = address.toLowerCase();

  // Gate 1 — verified human (fails closed on RPC error).
  if (!(await isVerifiedHuman(address))) {
    return NextResponse.json({ error: "Verify with GoodDollar first." }, { status: 403 });
  }
  const root = (await resolveIdentityRoot(address)).toLowerCase();

  // Gate 7 — per-root lock guards the whole check-then-send sequence.
  const lock = await redis.set(keys.gasLock(root), "1", { nx: true, ex: 30 });
  if (lock === null) return NextResponse.json({ ok: false, reason: "in_progress" });

  const today = new Date().toISOString().slice(0, 10);
  const ip = clientIp(req);
  const cdKey = keys.gasCooldown(root);
  const moKey = keys.gasMonthly(root);
  const dayKey = keys.gasDaily(today);
  const ipKey = keys.gasIpDaily(ip, today);

  try {
    // Gate 3 — cooldown.
    if (await redis.get(cdKey)) {
      return NextResponse.json({ ok: false, reason: "cooldown" });
    }
    // Gate 4 — rolling 30-day per-person cap.
    const monthly = Number((await redis.get(moKey)) ?? 0);
    if (monthly >= MONTHLY_CAP) {
      return NextResponse.json({ ok: false, reason: "monthly_cap" });
    }
    // Gate 5 — global daily circuit breaker.
    const daily = Number((await redis.get(dayKey)) ?? 0);
    if (daily >= DAILY_CAP) {
      console.warn("[gas-topup] DAILY CIRCUIT BREAKER hit:", daily);
      return NextResponse.json({ ok: false, reason: "faucet_resting" }, { status: 429 });
    }
    // Gate 6 — per-IP daily cap.
    const ipCount = Number((await redis.get(ipKey)) ?? 0);
    if (ipCount >= IP_DAILY_CAP) {
      return NextResponse.json({ ok: false, reason: "ip_cap" }, { status: 429 });
    }

    // Gate 2 — target must actually be low on gas (checked on-chain, never trusted).
    const balance = await publicClient.getBalance({ address: address as `0x${string}` });
    if (balance >= parseEther(THRESHOLD_CELO)) {
      return NextResponse.json({ ok: false, reason: "balance_ok" });
    }

    // Faucet solvency — refuse rather than bounce mid-send.
    const account = privateKeyToAccount(faucetKey);
    const faucetBalance = await publicClient.getBalance({ address: account.address });
    if (faucetBalance < parseEther(TOPUP_CELO) * 2n) {
      console.error("[gas-topup] FAUCET NEARLY EMPTY:", formatEther(faucetBalance), "CELO");
      return NextResponse.json({ ok: false, reason: "faucet_empty" }, { status: 503 });
    }

    // Mark limits BEFORE sending (fail-closed); roll back only on send failure.
    await Promise.all([
      redis.set(cdKey, "1", { ex: COOLDOWN_S }),
      redis.incr(moKey).then((n) => (n === 1 ? redis.expire(moKey, 30 * 24 * 3600) : null)),
      redis.incr(dayKey).then((n) => (n === 1 ? redis.expire(dayKey, 48 * 3600) : null)),
      redis.incr(ipKey).then((n) => (n === 1 ? redis.expire(ipKey, 48 * 3600) : null)),
    ]);

    let tx: `0x${string}`;
    try {
      const wallet = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });
      tx = await wallet.sendTransaction({
        to: address as `0x${string}`,
        value: parseEther(TOPUP_CELO),
      });
    } catch (e) {
      // Send failed — return the person's allowance so they can retry.
      await Promise.all([
        redis.del(cdKey),
        redis.decr(moKey).catch(() => {}),
        redis.decr(dayKey).catch(() => {}),
        redis.decr(ipKey).catch(() => {}),
      ]);
      console.error("[gas-topup] send failed", e);
      return NextResponse.json({ ok: false, reason: "send_failed" }, { status: 502 });
    }

    // Audit trail (capped at last 1000 payouts).
    redis.lpush(keys.gasLog(), JSON.stringify({ ts: Math.floor(Date.now() / 1000), address, root, ip, tx, amount: TOPUP_CELO }))
      .then(() => redis.ltrim(keys.gasLog(), 0, 999))
      .catch(() => {});

    return NextResponse.json({ ok: true, tx, amount: TOPUP_CELO });
  } catch (e) {
    console.error("[gas-topup]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  } finally {
    redis.del(keys.gasLock(root)).catch(() => {});
  }
}
