import { NextResponse } from "next/server";
import { erc20Abi } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { isAdminAuthed } from "@/lib/adminAuth";
import { publicClient } from "@/lib/publicClient";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";
import { REWARD_WALLET } from "@/lib/compPayout";
import { getCompConfig, owedWei, windowScoreRange } from "@/lib/competition";

export const runtime = "nodejs";

// GET /api/comp/status — admin-only. Everything the admin page needs to decide
// whether "Pay outstanding now" should be enabled, WITHOUT moving any funds:
// how much is owed, how much of that the pot still allows, and the reward
// wallet's live G$ + CELO balances.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  const cfg = await getCompConfig(redis);
  const wr = windowScoreRange(cfg);
  const spent = BigInt((await redis.get<string>(keys.compPotSpent())) ?? "0");
  const potRemaining = BigInt(cfg.potWei) > spent ? BigInt(cfg.potWei) - spent : 0n;

  const roots = (await redis.smembers(keys.compParticipants())) ?? [];
  const deltas = await Promise.all(roots.map(async (root) => {
    const [count, paidStr] = await Promise.all([
      redis.zcount(keys.referralCredited(root), wr.min, wr.max),
      redis.get<string>(keys.compPaid(root)),
    ]);
    const owed = owedWei(count ?? 0, cfg);
    const paid = BigInt(paidStr ?? "0");
    return owed > paid ? owed - paid : 0n;
  }));
  const totalOwed = deltas.reduce((s, d) => s + d, 0n);
  // What a payout run could actually settle right now (pot-capped).
  const settleable = totalOwed < potRemaining ? totalOwed : potRemaining;

  let walletBalWei = 0n, gasWei = 0n, balancesOk = true;
  try {
    walletBalWei = (await publicClient.readContract({ address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET] })) as bigint;
    gasWei = await publicClient.getBalance({ address: REWARD_WALLET });
  } catch { balancesOk = false; }

  return NextResponse.json({
    balancesOk,
    outstandingWei: totalOwed.toString(),
    settleableWei: settleable.toString(),
    potRemainingWei: potRemaining.toString(),
    potSpentWei: spent.toString(),
    walletBalWei: walletBalWei.toString(),
    gasWei: gasWei.toString(),
    // Enough G$ to settle everything the pot allows right now, with gas to spare.
    canSettle: balancesOk && settleable > 0n && walletBalWei >= settleable && gasWei >= 5n * 10n ** 15n,
    lowGas: balancesOk && gasWei < 5n * 10n ** 15n,
  });
}
