import { publicClient } from "@/lib/publicClient";
import { parseEther } from "viem";

// Enough native CELO to pay for a claim tx on Celo (a claim costs ~0.001–0.002).
const MIN_GAS = parseEther("0.003");

/**
 * Make sure a verified hunter has gas BEFORE we ask them to sign a claim, so a
 * background top-up that hasn't mined yet — or a freshly-empty wallet — never
 * becomes an "insufficient funds" failure mid-claim (our #1 support issue).
 *
 * - Fast-paths when they already have gas (the common case) → zero added latency.
 * - Triggers the faucet (server enforces all limits + the GoodDollar-first two
 *   tiers), then polls the balance with retries until the top-up lands.
 * - Best-effort: NEVER throws. If it can't top up in time, the claim proceeds and
 *   surfaces its own clear error rather than us blocking it on our own hiccup.
 *
 * Mirrors the GoodDollar SDK's "top up, then poll balance with retries" pattern.
 */
export async function ensureGasForClaim(
  address: `0x${string}`,
  onToppingUp?: () => void,
): Promise<void> {
  try {
    if ((await publicClient.getBalance({ address })) >= MIN_GAS) return; // already has gas
    onToppingUp?.();
    await fetch("/api/gas-topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch(() => {});
    // Poll until the top-up lands, or give up after ~22s and let the claim try.
    const deadline = Date.now() + 22_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if ((await publicClient.getBalance({ address })) >= MIN_GAS) return;
    }
  } catch { /* best-effort — never block the claim on our own error */ }
}
