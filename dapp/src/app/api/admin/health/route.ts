import { NextResponse } from "next/server";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { antispoofMode } from "@/lib/antispoof";
import { GOOD_DROPS_BADGES_ADDRESS, GOOD_DROPS_BADGES_ABI } from "@/lib/contracts";

export const runtime = "nodejs";

type Level = "ok" | "warn" | "error" | "off";
interface Check { key: string; label: string; status: Level; detail: string }

const has = (v: string | undefined | null) => !!v && v.trim().length > 0;

// GET /api/admin/health — at-a-glance status of every integration the new
// features depend on. Admin-cookie gated. Reports configuration + live
// connectivity (Redis ping, subgraph reachability) without leaking secrets.
export async function GET() {
  if (!(await isAdminAuthed()))
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });

  const checks: Check[] = [];

  // ── Redis (storage) ──────────────────────────────────────────────────────
  const redis = getRedis();
  let redisOk = false;
  if (!redis) {
    checks.push({ key: "redis", label: "Redis (Upstash)", status: "error", detail: "Not configured — landmarks, reports, push all degrade." });
  } else {
    try {
      const pong = await redis.ping();
      redisOk = true;
      checks.push({ key: "redis", label: "Redis (Upstash)", status: "ok", detail: `Connected (${pong}).` });
    } catch {
      checks.push({ key: "redis", label: "Redis (Upstash)", status: "error", detail: "Configured but unreachable." });
    }
  }

  // ── Subgraph (drops data) ────────────────────────────────────────────────
  const subUrl = process.env.NEXT_PUBLIC_SUBGRAPH_URL;
  if (!has(subUrl)) {
    checks.push({ key: "subgraph", label: "Subgraph", status: "error", detail: "NEXT_PUBLIC_SUBGRAPH_URL missing." });
  } else {
    try {
      const ctrl = AbortSignal.timeout(5000);
      const res = await fetch(subUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ _meta { block { number } } }" }),
        signal: ctrl,
      });
      const j = await res.json().catch(() => null);
      const block = j?.data?._meta?.block?.number;
      if (res.ok && block) checks.push({ key: "subgraph", label: "Subgraph", status: "ok", detail: `Indexed to block ${block}.` });
      else checks.push({ key: "subgraph", label: "Subgraph", status: "warn", detail: "Reachable but no _meta — check the URL." });
    } catch {
      checks.push({ key: "subgraph", label: "Subgraph", status: "error", detail: "Unreachable." });
    }
  }

  // ── Web push (VAPID) ─────────────────────────────────────────────────────
  const vapid = has(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) && has(process.env.VAPID_PRIVATE_KEY) && has(process.env.VAPID_EMAIL);
  checks.push({
    key: "push", label: "Web push (VAPID)",
    status: vapid ? "ok" : "off",
    detail: vapid ? "Keys configured — claim & nearby pushes can send." : "Missing VAPID keys — no push notifications.",
  });

  // ── Internal notify secret ───────────────────────────────────────────────
  checks.push({
    key: "internalSecret", label: "Internal notify secret",
    status: has(process.env.INTERNAL_WEBHOOK_SECRET) ? "ok" : "error",
    detail: has(process.env.INTERNAL_WEBHOOK_SECRET) ? "Set." : "Missing — webhook & cron can't call /api/push/notify.",
  });

  // ── Goldsky webhook secret ───────────────────────────────────────────────
  checks.push({
    key: "goldsky", label: "Goldsky webhook secret",
    status: has(process.env.GOLDSKY_WEBHOOK_SECRET) ? "ok" : "warn",
    detail: has(process.env.GOLDSKY_WEBHOOK_SECRET)
      ? "Set — forged drop events are rejected."
      : "Unset — /api/push/webhook is unauthenticated (recommended to set).",
  });

  // ── Cron secret (re-verify reminders) ────────────────────────────────────
  checks.push({
    key: "cron", label: "Re-verify cron secret",
    status: has(process.env.CRON_SECRET) ? "ok" : "off",
    detail: has(process.env.CRON_SECRET) ? "Set — reminder cron can run." : "Unset — /api/cron/reverify fails closed (reminders off).",
  });

  // ── Admin password & GPS signer ──────────────────────────────────────────
  checks.push({
    key: "adminPassword", label: "Admin password",
    status: has(process.env.ADMIN_PASSWORD) ? "ok" : "error",
    detail: has(process.env.ADMIN_PASSWORD) ? "Set." : "Missing — admin area would be locked out.",
  });
  checks.push({
    key: "gpsSigner", label: "GPS claim signer",
    status: has(process.env.GPS_SIGNER_KEY) ? "ok" : "off",
    detail: has(process.env.GPS_SIGNER_KEY) ? "Set — proximity claims can be signed." : "Missing — GPS-gated claims won't sign.",
  });

  // ── Anti-spoof mode ───────────────────────────────────────────────────────
  const spoofMode = antispoofMode();
  checks.push({
    key: "antispoof", label: "Anti-spoof (presence proof)",
    status: spoofMode === "enforce" ? "ok" : spoofMode === "shadow" ? "warn" : "error",
    detail: spoofMode === "enforce"
      ? "Enforcing — spoofed claims are rejected."
      : spoofMode === "shadow"
      ? "Shadow mode — logging suspicious claims but not blocking. Review flags, then set ANTISPOOF_MODE=enforce."
      : "OFF — presence is spoofable. Set ANTISPOOF_MODE=shadow.",
  });

  // ── Badge minting (signer address must match the on-chain badgeSigner) ─────
  const badgeSignerKey = process.env.BADGE_SIGNER_KEY as `0x${string}` | undefined;
  if (!badgeSignerKey) {
    checks.push({ key: "badgeMint", label: "Badge minting", status: "off", detail: "BADGE_SIGNER_KEY unset — on-chain badge minting disabled (off-chain badges still work)." });
  } else {
    try {
      const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
      const onChainSigner = await client.readContract({
        address: GOOD_DROPS_BADGES_ADDRESS, abi: GOOD_DROPS_BADGES_ABI, functionName: "badgeSigner",
      });
      const local = privateKeyToAccount(badgeSignerKey).address;
      const match = onChainSigner.toLowerCase() === local.toLowerCase();
      checks.push({
        key: "badgeMint", label: "Badge minting",
        status: match ? "ok" : "error",
        detail: match ? "Signer matches on-chain badgeSigner." : `MISMATCH: contract expects ${onChainSigner.slice(0, 10)}… but BADGE_SIGNER_KEY is ${local.slice(0, 10)}…`,
      });
    } catch {
      checks.push({ key: "badgeMint", label: "Badge minting", status: "warn", detail: "Configured but couldn't read on-chain badgeSigner (RPC / wrong address?)." });
    }
  }

  // ── Gas faucet ────────────────────────────────────────────────────────────
  const faucetKey = process.env.GAS_FAUCET_KEY as `0x${string}` | undefined;
  if (!faucetKey) {
    checks.push({ key: "gasFaucet", label: "Gas top-up faucet", status: "off", detail: "GAS_FAUCET_KEY unset — hunters with 0 CELO can't pay claim gas." });
  } else {
    try {
      const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
      const account = privateKeyToAccount(faucetKey);
      const bal = await client.getBalance({ address: account.address });
      const low = bal < parseEther("2");
      checks.push({
        key: "gasFaucet", label: "Gas top-up faucet",
        status: low ? "warn" : "ok",
        detail: `${Number(formatEther(bal)).toFixed(2)} CELO in ${account.address.slice(0, 8)}…${low ? " — LOW, refill soon." : "."}`,
      });
    } catch {
      checks.push({ key: "gasFaucet", label: "Gas top-up faucet", status: "warn", detail: "Configured but balance check failed (RPC)." });
    }
  }

  // ── Operational stats (only if Redis is live) ────────────────────────────
  let stats: Record<string, number> | null = null;
  if (redis && redisOk) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [subscribers, huntersSharingLocation, reportedDrops, hiddenDrops, landmarks, spoofFlags, gasToday] = await Promise.all([
        redis.scard(keys.subscribersIndex()),
        redis.hlen(keys.huntersLoc()),
        redis.scard(keys.reportedDropsIndex()),
        redis.scard(keys.hiddenDrops()),
        redis.scard(keys.landmarksIndex()),
        redis.llen(keys.spoofFlags()),
        redis.get<number>(keys.gasDaily(today)).then((n) => Number(n ?? 0)),
      ]);
      stats = { subscribers, huntersSharingLocation, reportedDrops, hiddenDrops, landmarks, spoofFlags, gasTopupsToday: gasToday };
    } catch { /* stats are best-effort */ }
  }

  const worst: Level = checks.some((c) => c.status === "error") ? "error"
    : checks.some((c) => c.status === "warn") ? "warn"
    : checks.some((c) => c.status === "off") ? "off" : "ok";

  return NextResponse.json({ overall: worst, checks, stats, at: Date.now() });
}
