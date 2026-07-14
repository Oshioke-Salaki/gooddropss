import { parseAbi, type PublicClient } from "viem";

export const IDENTITY_ADDRESS =
  "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;

const ZERO = "0x0000000000000000000000000000000000000000";

// GoodDollar IdentityV4 puts verification on a LADDER, not a single expiry:
//
//   reverifyDaysOptions = [3, 180]
//
// Your first face verification (authCount = 0) is only valid for THREE DAYS.
// You must re-authenticate once inside that window — which bumps authCount to 1
// — and only then do you get the full 180 days.
//
// Anyone authenticated before TEMP_EXCLUSION_TS is grandfathered straight onto
// the final rung by the contract, which is why older wallets appear to "just
// work" while every new user silently falls off a cliff after 3 days.
//
// isWhitelisted() returns false the moment the current rung elapses, so
// getWhitelistedRoot() goes to zero and the user looks like they never verified
// at all. Distinguishing "never verified" from "verified but lapsed" is the
// whole point of this module — the two need completely different copy.
const TEMP_EXCLUSION_TS = 1772697574n;

const IDENTITY_ABI = parseAbi([
  "function getWhitelistedRoot(address account) view returns (address)",
  "function identities(address) view returns (uint256 dateAuthenticated, uint256 dateAdded, string did, uint256 whitelistedOnChainId, uint8 status, uint32 authCount)",
  "function reverifyDaysOptions(uint256) view returns (uint256)",
]);

export type IdentityState =
  | "none"          // never face-verified
  | "verified"      // whitelisted and current
  | "lapsed"        // face-verified, but the window ran out — needs a re-check
  | "blacklisted";

export interface IdentityStatus {
  state:         IdentityState;
  /** Whitelisted root (self, or the root this wallet is connected to). */
  root:          `0x${string}` | null;
  /** Lapsed (or about to lapse) on the FIRST 3-day rung, not the 180-day one. */
  isProbation:   boolean;
  /** Length of the rung this wallet is currently on. */
  windowDays:    number;
  /** Days remaining before it lapses. 0 when already lapsed. */
  daysLeft:      number;
  daysSinceAuth: number;
}

export const NONE: IdentityStatus = {
  state: "none", root: null, isProbation: false,
  windowDays: 0, daysLeft: 0, daysSinceAuth: 0,
};

// The ladder is immutable in practice; read it once per page load.
let rungsCache: number[] | null = null;
async function readRungs(client: PublicClient): Promise<number[]> {
  if (rungsCache) return rungsCache;
  const rungs: number[] = [];
  for (let i = 0; i < 8; i++) {
    try {
      const d = await client.readContract({
        address: IDENTITY_ADDRESS, abi: IDENTITY_ABI,
        functionName: "reverifyDaysOptions", args: [BigInt(i)],
      });
      rungs.push(Number(d));
    } catch {
      break; // out of bounds — that's the whole ladder
    }
  }
  // Defensive: never let an RPC hiccup produce an empty ladder.
  rungsCache = rungs.length ? rungs : [3, 180];
  return rungsCache;
}

export async function readIdentityStatus(
  client: PublicClient,
  address: string,
): Promise<IdentityStatus> {
  const root = (await client.readContract({
    address: IDENTITY_ADDRESS, abi: IDENTITY_ABI,
    functionName: "getWhitelistedRoot", args: [address as `0x${string}`],
  })) as `0x${string}`;

  const isWhitelisted = root.toLowerCase() !== ZERO;

  // A wallet linked via connectAccount has an EMPTY identity record of its own —
  // its dates live on the root. Always read the rung data from whoever actually
  // holds the identity.
  const subject = (isWhitelisted ? root : address) as `0x${string}`;

  const [id, rungs] = await Promise.all([
    client.readContract({
      address: IDENTITY_ADDRESS, abi: IDENTITY_ABI,
      functionName: "identities", args: [subject],
    }),
    readRungs(client),
  ]);

  const [dateAuthenticated, , , , status, authCount] = id as unknown as [
    bigint, bigint, string, bigint, number, number,
  ];

  if (status === 255) return { ...NONE, state: "blacklisted" };

  // Never verified: no identity record at all.
  if (dateAuthenticated === 0n) return NONE;

  const grandfathered = dateAuthenticated < TEMP_EXCLUSION_TS;
  const rung          = grandfathered
    ? rungs.length - 1
    : Math.min(authCount, rungs.length - 1);
  const windowDays    = rungs[rung];
  const daysSinceAuth = Math.floor(
    (Date.now() / 1000 - Number(dateAuthenticated)) / 86_400,
  );
  const daysLeft   = Math.max(0, windowDays - daysSinceAuth);
  const isProbation = !grandfathered && authCount === 0;

  return {
    state: isWhitelisted ? "verified" : "lapsed",
    root: isWhitelisted ? root : null,
    isProbation,
    windowDays,
    daysLeft,
    daysSinceAuth,
  };
}

// Verified, but the clock is about to run out. On the 3-day probation rung this
// is the difference between a user who keeps their account and one who loses it.
export function isExpiringSoon(s: IdentityStatus): boolean {
  if (s.state !== "verified") return false;
  return s.isProbation ? s.daysLeft <= 2 : s.daysLeft <= 14;
}
