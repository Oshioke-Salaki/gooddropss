import { keccak256, encodePacked, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// The proximity proof the GoodDrops contract checks in claimWithProof:
//   recover(toEthSignedMessageHash(keccak256(abi.encodePacked(dropId, claimer, deadline)))) == gpsSigner
// One implementation, used by /api/claim-proof and by the forked-chain tests,
// so the tests prove what production actually signs.

export function claimProofDigest(dropId: bigint, claimer: `0x${string}`, deadline: bigint): Hex {
  return keccak256(encodePacked(["uint256", "address", "uint256"], [dropId, claimer, deadline]));
}

export async function signClaimProof(
  signerKey: Hex,
  dropId: bigint,
  claimer: `0x${string}`,
  deadline: bigint,
): Promise<Hex> {
  const account = privateKeyToAccount(signerKey);
  return account.signMessage({ message: { raw: claimProofDigest(dropId, claimer, deadline) } });
}
