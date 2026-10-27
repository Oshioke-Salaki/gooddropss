import { publicClient } from "@/lib/publicClient";
import { weiNeeded } from "@/lib/gasNeeds";

/**
 * Make sure a verified hunter has gas BEFORE we ask them to sign a claim, so a
 * background top-up that hasn't mined yet, or a freshly-empty wallet, never
 * becomes an "insufficient funds" failure mid-claim.
 *
 * - "Enough" comes from the live gas price (see gasNeeds), not a fixed number.
 * - Fast-paths when they already have enough, so no added latency.
 * - Triggers the faucet (the server enforces every limit), then polls the
 *   balance until the top-up lands.
 * - Best-effort: NEVER throws. If it can't top up in time, the claim proceeds
 *   and surfaces its own clear error rather than us blocking it.
 */
export async function ensureGasForClaim(
  address: `0x${string}`,
  onToppingUp?: () => void,
): Promise<void> {
  try {
    const need = weiNeeded(await publicClient.getGasPrice());
    if ((await publicClient.getBalance({ address })) >= need) return;
    onToppingUp?.();
    const res = await fetch("/api/gas-topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch(() => null);
    // The faucet said no (not verified, cooldown, cap...) or is unreachable:
    // nothing is coming, so don't make the user wait for it.
    const body = res ? await res.json().catch(() => null) as { ok?: boolean; reason?: string } | null : null;
    if (!body?.ok && body?.reason !== "in_progress") return;
    // Poll until the top-up lands, or give up after ~22s and let the claim try.
    const deadline = Date.now() + 22_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if ((await publicClient.getBalance({ address })) >= need) return;
    }
  } catch { /* best-effort: never block the claim on our own error */ }
}
