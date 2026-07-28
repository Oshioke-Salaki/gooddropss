import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { getRedis, keys } from "@/lib/redis";
import { isVerifiedHuman, resolveIdentityRoot } from "@/lib/identityRoot";
import { normalizePk } from "@/lib/pk";

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
// Global circuit breaker. Raised now that most top-ups are Tier-1 (GoodDollar-
// funded, ~free to us); worst-case OUR CELO spend is still bounded by the
// per-person gates (verified-only, 3-day cooldown, 3/month, IP cap). Env-overridable.
const DAILY_CAP       = Number(process.env.GAS_TOPUP_MAX_PER_DAY ?? 300);
const IP_DAILY_CAP    = 5;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// GoodDollar's own FaucetV2 (Celo mainnet). It tops up verified users' gas from
// GOODDOLLAR's reserve — and `topWallet(user)` is callable by anyone, so our
// relayer can trigger it for a hunter and pay only the (tiny) submission gas.
// This is Tier 1; our self-funded faucet below is only the fallback.
const GD_FAUCET_ADDRESS = "0x4F93Fa058b03953C851eFaA2e4FC5C34afDFAb84" as const;
const GD_FAUCET_ABI = [
  { type: "function", name: "canTop",     stateMutability: "view",    inputs: [{ name: "_user", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "topWallet",  stateMutability: "payable", inputs: [{ name: "_user", type: "address" }], outputs: [] },
] as const;

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
  const faucetKey = normalizePk(process.env.GAS_FAUCET_KEY);
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

    const account = privateKeyToAccount(faucetKey);
    const wallet  = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

    // Mark limits BEFORE sending (fail-closed); rolled back only if BOTH tiers fail.
    await Promise.all([
      redis.set(cdKey, "1", { ex: COOLDOWN_S }),
      redis.incr(moKey).then((n) => (n === 1 ? redis.expire(moKey, 30 * 24 * 3600) : null)),
      redis.incr(dayKey).then((n) => (n === 1 ? redis.expire(dayKey, 48 * 3600) : null)),
      redis.incr(ipKey).then((n) => (n === 1 ? redis.expire(ipKey, 48 * 3600) : null)),
    ]);
    const rollback = () => Promise.all([
      redis.del(cdKey),
      redis.decr(moKey).catch(() => {}),
      redis.decr(dayKey).catch(() => {}),
      redis.decr(ipKey).catch(() => {}),
    ]);

    let tx: `0x${string}` | null = null;
    let via: "gooddollar" | "self" = "self";

    // ── Tier 1 — GoodDollar's faucet (funded by GoodDollar; we pay only gas) ──
    try {
      const canTop = await publicClient.readContract({
        address: GD_FAUCET_ADDRESS, abi: GD_FAUCET_ABI, functionName: "canTop", args: [address as `0x${string}`],
      });
      if (canTop) {
        const t = await wallet.writeContract({
          address: GD_FAUCET_ADDRESS, abi: GD_FAUCET_ABI, functionName: "topWallet", args: [address as `0x${string}`],
        });
        const rc = await publicClient.waitForTransactionReceipt({ hash: t, timeout: 25_000 });
        if (rc.status === "success") { tx = t; via = "gooddollar"; }
      }
    } catch (e) {
      console.warn("[gas-topup] GoodDollar faucet unavailable, falling back to self-fund", e);
    }

    // ── Tier 2 — our own faucet (spends our CELO), only if Tier 1 didn't cover it ──
    if (!tx) {
      const faucetBalance = await publicClient.getBalance({ address: account.address });
      if (faucetBalance < parseEther(TOPUP_CELO) * 2n) {
        console.error("[gas-topup] SELF FAUCET NEARLY EMPTY:", formatEther(faucetBalance), "CELO");
        await rollback();
        return NextResponse.json({ ok: false, reason: "faucet_empty" }, { status: 503 });
      }
      try {
        tx = await wallet.sendTransaction({ to: address as `0x${string}`, value: parseEther(TOPUP_CELO) });
        via = "self";
      } catch (e) {
        await rollback();
        console.error("[gas-topup] self send failed", e);
        return NextResponse.json({ ok: false, reason: "send_failed" }, { status: 502 });
      }
    }

    // Audit trail (capped at last 1000 payouts). `via` shows who paid.
    redis.lpush(keys.gasLog(), JSON.stringify({ ts: Math.floor(Date.now() / 1000), address, root, ip, tx, via, amount: via === "self" ? TOPUP_CELO : "gooddollar" }))
      .then(() => redis.ltrim(keys.gasLog(), 0, 999))
      .catch(() => {});

    return NextResponse.json({ ok: true, tx, via, amount: via === "self" ? TOPUP_CELO : null });
  } catch (e) {
    console.error("[gas-topup]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  } finally {
    redis.del(keys.gasLock(root)).catch(() => {});
  }
}
