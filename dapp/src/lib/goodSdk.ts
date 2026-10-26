import { IdentitySDK } from "@goodsdks/identity-sdk";
import { ClaimSDK } from "@goodsdks/citizen-sdk";

// The GoodDollar SDKs are built against their own copy of viem, so wagmi's
// client types don't line up with theirs nominally even though they're the very
// same runtime objects. These two constructors are the one place that bridges
// the types — the calls themselves are exactly what the SDK docs prescribe.

type IdentityArgs = ConstructorParameters<typeof IdentitySDK>;
type ClaimOptions = ConstructorParameters<typeof ClaimSDK>[0];

export function makeIdentitySDK(publicClient: unknown, walletClient: unknown): IdentitySDK {
  return new IdentitySDK(...([publicClient, walletClient, "production"] as unknown as IdentityArgs));
}

export function makeClaimSDK(opts: {
  account: `0x${string}`;
  publicClient: unknown;
  walletClient: unknown;
  identitySDK: unknown;
}): ClaimSDK {
  return new ClaimSDK({ ...opts, env: "production" } as unknown as ClaimOptions);
}
