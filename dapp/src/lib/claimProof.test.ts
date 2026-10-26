import { describe, it, expect } from "vitest";
import { keccak256, encodePacked, recoverMessageAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { claimProofDigest, signClaimProof } from "./claimProof";

describe("claim proof", () => {
  const claimer = "0x00000000000000000000000000000000000000aa" as const;

  it("hashes exactly what the route used to hash inline", () => {
    const inline = keccak256(encodePacked(["uint256", "address", "uint256"], [42n, claimer, 1_800_000_000n]));
    expect(claimProofDigest(42n, claimer, 1_800_000_000n)).toBe(inline);
  });

  it("produces a signature that recovers to the signer over the eth-signed digest", async () => {
    const pk = generatePrivateKey();
    const sig = await signClaimProof(pk, 7n, claimer, 123n);
    const who = await recoverMessageAddress({ message: { raw: claimProofDigest(7n, claimer, 123n) }, signature: sig });
    expect(who).toBe(privateKeyToAccount(pk).address);
  });
});
