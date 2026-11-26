// Server only. Reads the reward wallet's CELO and today's gas price.
import { publicClient } from "@/lib/publicClient";
import { memo } from "@/lib/serverCache";
import { REWARD_WALLET_ADDRESS } from "@/lib/contracts";
import { rewardGasStatus, TOPUP_WEI, type RewardGas } from "@/lib/rewardGas";
import { parseEther } from "viem";

/** Cached for a minute: admin pages poll it, and gas doesn't move that fast. */
export function readRewardGas(): Promise<RewardGas> {
  return memo("reward:gas", 60_000, async () => {
    const [bal, price] = await Promise.all([
      publicClient.getBalance({ address: REWARD_WALLET_ADDRESS }),
      publicClient.getGasPrice(),
    ]);
    let topUp = TOPUP_WEI;
    try { if (process.env.GAS_TOPUP_AMOUNT_CELO) topUp = parseEther(process.env.GAS_TOPUP_AMOUNT_CELO); } catch { /* default */ }
    return rewardGasStatus(bal, price, topUp);
  });
}
