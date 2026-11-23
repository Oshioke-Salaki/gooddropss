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

/**
 * Server gate for shop owners running rewards (saving a reward, unlocking the
 * scanner, approving a customer). Three answers, so a failed read is never
 * mistaken for "not verified" (or worse, for "verified"):
 *   "verified"   may go ahead
 *   "unverified" never verified, lapsed, or blocked: refuse (403)
 *   "unknown"    GoodDollar couldn't be read: refuse for now, ask to retry (503)
 */
export async function ownerVerification(address: string): Promise<"verified" | "unverified" | "unknown"> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await readIdentityStatus(publicClient as any, address);
    return s.state === "verified" ? "verified" : "unverified";
  } catch {
    return "unknown";
  }
}

/** The response pieces for a refused owner gate. */
export const OWNER_GATE = {
  unverified: { status: 403, error: "Verify your GoodDollar identity to run rewards at your shop." },
  unknown: { status: 503, error: "We couldn't confirm you're verified right now. Please try again." },
} as const;
