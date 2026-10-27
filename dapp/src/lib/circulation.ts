// "G$ circulated", one definition for the whole app (team's definition, Oct 2026):
//   every G$ hidden in a drop (on-chain, from the Goldsky subgraph)
//   + G$ paid out in competition and campaign rewards (competition wallet,
//     0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605).
// Public pages show only the total; never break out the rewards part.
// When the team pays out new prizes, raise REWARDS_G to the new running total.

export const REWARDS_G = 3_700_000;
export const REWARDS_WEI = BigInt(REWARDS_G) * 10n ** 18n;

/** Whole G$ circulated, given whole G$ dropped. */
export function circulatedG(droppedG: number): number {
  return droppedG + REWARDS_G;
}
