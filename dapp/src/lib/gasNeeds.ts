// How much CELO a wallet needs to pay for one GoodDrops transaction, from the
// LIVE gas price. Shared by the client (ensureGas) and the faucet route so they
// can never disagree about "enough".
//
// Measured on Celo mainnet, Oct 2026 (base fee ~200 gwei):
//   claimWithProof   ~290–310k gas   ~0.06 CELO
//   createDrop       ~320–345k gas   ~0.07 CELO
//   createManyDrops  ~400–630k gas   ~0.08–0.13 CELO
// The old fixed 0.003 / 0.01 CELO thresholds dated from ~5 gwei and let wallets
// holding 0.01–0.06 CELO pass the check and then fail with "insufficient funds".

/** Gas budget for a claim, with headroom over the ~310k worst case seen. */
export const CLAIM_GAS = 360_000n;

/** Wei needed to send a tx using `gas` units at `gasPrice`, plus 20% for fee drift. */
export function weiNeeded(gasPrice: bigint, gas: bigint = CLAIM_GAS): bigint {
  return (gasPrice * gas * 12n) / 10n;
}
