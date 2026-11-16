import { publicClient } from "@/lib/publicClient";
import { readIdentityStatus } from "@/lib/identity";

/**
 * The verification gate for dropping. Read fresh from GoodDollar at the moment
 * someone taps Drop, and FAIL CLOSED: only a confirmed "verified" lets a drop
 * through. (The contract itself only checks verification on CLAIM, so this is
 * the one place that keeps unverified wallets from hiding G$.)
 *
 * Returns null when they may drop, otherwise the sentence to show them.
 */
export async function dropBlockedReason(address: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await readIdentityStatus(publicClient as any, address);
    if (s.state === "verified") return null;
    if (s.state === "lapsed") return "Re-verify your GoodDollar identity to drop.";
    if (s.state === "blacklisted") return "This wallet can't drop because GoodDollar has blocked its verification.";
    return "Verify your GoodDollar identity to drop.";
  } catch {
    return "We couldn't confirm you're verified. Check your connection and try again.";
  }
}
