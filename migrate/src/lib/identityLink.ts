"use client";
import {
  createPublicClient, createWalletClient, custom, http,
  parseAbi, type EIP1193Provider, type WalletClient,
} from "viem";
import { celo } from "viem/chains";
import { IdentitySDK } from "@goodsdks/citizen-sdk";

const G_TOKEN = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A" as const;
const ZERO    = "0x0000000000000000000000000000000000000000";

const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

/** Build a viem WalletClient on Celo from any legacy provider's EIP-1193 interface. */
export async function walletClientFromProvider(
  provider: EIP1193Provider,
  address: string,
): Promise<WalletClient> {
  return createWalletClient({
    account: address as `0x${string}`,
    chain: celo,
    transport: custom(provider),
  });
}

/** True if `address` is the GoodDollar-verified root (self-resolves), i.e. can sign a link. */
export async function isVerifiedRoot(address: string): Promise<boolean> {
  try {
    const root = (await publicClient.readContract({
      address: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
      abi: parseAbi(["function getWhitelistedRoot(address) view returns (address)"]),
      functionName: "getWhitelistedRoot",
      args: [address as `0x${string}`],
    })) as string;
    return root.toLowerCase() !== ZERO;
  } catch {
    return false;
  }
}

/** getWhitelistedRoot for the new wallet — non-zero means the link succeeded. */
export async function rootOf(address: string): Promise<string> {
  const root = (await publicClient.readContract({
    address: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
    abi: parseAbi(["function getWhitelistedRoot(address) view returns (address)"]),
    functionName: "getWhitelistedRoot",
    args: [address as `0x${string}`],
  })) as string;
  return root.toLowerCase();
}

/**
 * Link the new Magic wallet to the old verified identity.
 * MUST be signed by the OLD (root) wallet — GoodDollar requires the whitelisted
 * root to be the signer of connectAccount.
 */
export async function linkNewWallet(
  oldWalletClient: WalletClient,
  oldAddress: string,
  newMagicAddress: string,
  onHash?: (hash: `0x${string}`) => void,
): Promise<void> {
  // citizen-sdk bundles its own copy of viem, so its PublicClient/WalletClient
  // types are nominally different from ours even though they're runtime-identical.
  // Cast at this single boundary (the main dapp does the same).
  const sdk = new IdentitySDK({
    account: oldAddress as `0x${string}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: publicClient as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walletClient: oldWalletClient as any,
    env: "production",
  });

  await sdk.connectAccount(newMagicAddress as `0x${string}`, {
    // Headless: this is a deliberate, user-initiated migration action.
    skipSecurityMessage: true,
    onHash,
  });
}

/** Sweep the old wallet's entire G$ balance to the new Magic wallet. */
export async function sweepGDollar(
  oldWalletClient: WalletClient,
  oldAddress: string,
  newMagicAddress: string,
): Promise<{ swept: bigint; tx?: `0x${string}` }> {
  const balance = (await publicClient.readContract({
    address: G_TOKEN, abi: ERC20, functionName: "balanceOf",
    args: [oldAddress as `0x${string}`],
  })) as bigint;

  if (balance === 0n) return { swept: 0n };

  const tx = await oldWalletClient.writeContract({
    address: G_TOKEN, abi: ERC20, functionName: "transfer",
    args: [newMagicAddress as `0x${string}`, balance],
    account: oldAddress as `0x${string}`,
    chain: celo,
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  return { swept: balance, tx };
}

export async function gDollarBalance(address: string): Promise<bigint> {
  return (await publicClient.readContract({
    address: G_TOKEN, abi: ERC20, functionName: "balanceOf",
    args: [address as `0x${string}`],
  })) as bigint;
}

/** Native CELO balance (for the gas check). */
export async function celoBalance(address: string): Promise<bigint> {
  return publicClient.getBalance({ address: address as `0x${string}` });
}
