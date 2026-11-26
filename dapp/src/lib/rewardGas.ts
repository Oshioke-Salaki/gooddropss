// Is the reward wallet able to pay for gas?
//
// The reward wallet (REWARD_WALLET_ADDRESS) sends every referral payout and
// first-drop bonus, hides welcome chests, and tops up players' CELO so they can
// claim (until Nov 2026). All of it needs CELO for gas. When it ran dry in Nov 2026, payouts failed
// silently for a day and a half: the old check (a fixed 0.005 CELO) assumed cheap
// gas, but a G$ transfer costs ~215k gas and the price had climbed to ~200 gwei.
//
// So the threshold is counted in PAYOUTS LEFT at today's gas price, not in CELO.

/** Gas one G$ transfer from the reward wallet uses (measured ~215k), with headroom. */
export const TRANSFER_GAS = 240_000n;
/** Below this many payouts left, warn: refill soon. */
export const LOW_PAYOUTS = 40;
/** Below this, payouts and gas top-ups are about to fail. */
export const CRITICAL_PAYOUTS = 5;

export type GasLevel = "ok" | "low" | "critical";

export interface RewardGas {
  level: GasLevel;
  /** Whole payouts the CELO balance covers at today's gas price. */
  payoutsLeft: number;
  /** CELO held, as a decimal string with 4 places. */
  celo: string;
  /** CELO to send to get back to a comfortable buffer (0 when ok). */
  topUpCelo: string;
  /** Gas price in gwei, rounded. */
  gwei: number;
}

const fmt = (wei: bigint) => (Number(wei / 10n ** 14n) / 10_000).toFixed(4);

/** Pure: what the balance and gas price mean. */
export function rewardGasStatus(balanceWei: bigint, gasPriceWei: bigint): RewardGas {
  const perPayout = (gasPriceWei > 0n ? gasPriceWei : 1n) * TRANSFER_GAS;
  const payoutsLeft = Number(balanceWei / perPayout);
  const level: GasLevel = payoutsLeft < CRITICAL_PAYOUTS ? "critical" : payoutsLeft < LOW_PAYOUTS ? "low" : "ok";
  // Aim for 100 payouts of headroom (player gas top-ups are off since Nov 2026).
  const target = perPayout * 100n;
  const topUp = level === "ok" || balanceWei >= target ? 0n : target - balanceWei;
  return { level, payoutsLeft, celo: fmt(balanceWei), topUpCelo: fmt(topUp), gwei: Math.round(Number(gasPriceWei) / 1e9) };
}
