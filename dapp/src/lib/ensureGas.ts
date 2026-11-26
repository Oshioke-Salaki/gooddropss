import { publicClient } from "@/lib/publicClient";
import { weiNeeded } from "@/lib/gasNeeds";

/** Thrown when a wallet can't pay the network fee. Its message maps to the "gas" error. */
export class NotEnoughGasError extends Error {
  constructor() { super("not enough celo for gas"); this.name = "NotEnoughGasError"; }
}

/**
 * Check a wallet can pay gas BEFORE we ask it to sign, so a short wallet gets a
 * clear "ask for gas in the community" message instead of a failed transaction.
 *
 * We no longer top wallets up ourselves (Nov 2026): email and Google wallets
 * have their gas paid, and wallet users ask in the Telegram community.
 *
 * - "Enough" comes from the live gas price (see gasNeeds), not a fixed number.
 * - Throws NotEnoughGasError only when the wallet is definitely short; if the
 *   chain can't be read, the action goes ahead and reports its own result.
 * `_onToppingUp` is kept so callers don't change; nothing is topped up now.
 */
export async function ensureGasForClaim(address: `0x${string}`, _onToppingUp?: () => void): Promise<void> {
  let short = false;
  try {
    const need = weiNeeded(await publicClient.getGasPrice());
    short = (await publicClient.getBalance({ address })) < need;
  } catch { /* can't tell: let the action try */ }
  if (short) throw new NotEnoughGasError();
}
