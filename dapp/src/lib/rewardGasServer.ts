// Server only. Reads the reward wallet's CELO, its G$ and today's gas price.
import { erc20Abi } from "viem";
import { publicClient } from "@/lib/publicClient";
import { memo } from "@/lib/serverCache";
import { G_TOKEN_ADDRESS, REWARD_WALLET_ADDRESS } from "@/lib/contracts";
import { rewardFundsStatus, rewardGasStatus, type RewardFunds, type RewardGas } from "@/lib/rewardGas";

/** Cached for a minute: admin pages poll it, and balances don't move that fast. */
export function readRewardGas(): Promise<RewardGas & RewardFunds> {
  return memo("reward:gas", 60_000, async () => {
    const [bal, price, g] = await Promise.all([
      publicClient.getBalance({ address: REWARD_WALLET_ADDRESS }),
      publicClient.getGasPrice(),
      publicClient.readContract({ address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET_ADDRESS] }) as Promise<bigint>,
    ]);
    return { ...rewardGasStatus(bal, price), ...rewardFundsStatus(g) };
  });
}
