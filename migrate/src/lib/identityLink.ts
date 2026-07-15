"use client";
import {
  createPublicClient, createWalletClient, custom, http, getAddress,
  parseAbi, type EIP1193Provider, type WalletClient,
} from "viem";
import { celo } from "viem/chains";
import { IdentitySDK } from "@goodsdks/citizen-sdk";
import { readIdentityStatus, NONE, type IdentityStatus } from "@/lib/identity";

export type { IdentityStatus };

const G_TOKEN = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A" as const;
const ZERO    = "0x0000000000000000000000000000000000000000";

const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

const CELO_HEX = "0xa4ec"; // 42220

/**
 * Make sure the legacy provider is actually on Celo before we send a transaction.
 *
 * Re-verification only needed a message SIGNATURE, which works on any chain — so a
 * wallet can re-verify successfully and still have its provider pointed at the
 * wrong network. connectAccount() and the G$ sweep are real transactions and must
 * go out on Celo. The Privy path calls switchChain() already; Web3Auth's embedded
 * provider does not, which is how a funded wallet ends up failing to send. This
 * asks the provider to switch (adding Celo if it doesn't know it), and is a no-op
 * for a provider that's already there.
 */
export async function ensureCelo(provider: EIP1193Provider): Promise<void> {
  try {
    const current = (await provider.request({ method: "eth_chainId" })) as string;
    if (current?.toLowerCase() === CELO_HEX) return;
  } catch {
    /* some embedded providers don't implement eth_chainId — try switching anyway */
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CELO_HEX }],
    });
  } catch (e) {
    // 4902 = chain unknown to the wallet; add it, then it's selected.
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CELO_HEX,
          chainName: "Celo",
          nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
          rpcUrls: ["https://forno.celo.org"],
          blockExplorerUrls: ["https://celoscan.io"],
        }],
      });
    }
    // Any other error: don't block. viem still passes chain: celo to the tx, and
    // if the network is genuinely wrong the tx error surfaces the real reason.
  }
}

/** Build a viem WalletClient on Celo from any legacy provider's EIP-1193 interface.
 *
 * The account is CHECKSUMMED here, and it matters for more than tidiness: the
 * GoodDollar FV link embeds this address inside the message the wallet signs
 * (FV_IDENTIFIER_MSG2). GoodDollar's verification page reconstructs that message
 * with the checksummed address before recovering the signer — so signing a
 * message that embeds a lowercase address recovers a *different* address and the
 * page dead-ends with "Login information is missing". Checksumming once, here,
 * keeps every downstream signer (re-verify link, connectAccount, sweep) aligned. */
export async function walletClientFromProvider(
  provider: EIP1193Provider,
  address: string,
): Promise<WalletClient> {
  return createWalletClient({
    account: getAddress(address),
    chain: celo,
    transport: custom(provider),
  });
}

/**
 * Full GoodDollar identity picture for the old wallet.
 *
 * A bare getWhitelistedRoot() != 0 check cannot tell "never verified" from
 * "verified but lapsed" — and the second case is the COMMON one, because
 * GoodDollar's IdentityV4 only gives first-time verifiers a 3-day window.
 * That distinction matters here more than anywhere: connectAccount() is
 * `onlyWhitelisted`, so a lapsed user physically CANNOT link a new wallet until
 * they re-verify. Telling them "there's no identity to link" sends them down the
 * rescue path and quietly loses their verified identity forever.
 */
export async function identityStatus(address: string): Promise<IdentityStatus> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await readIdentityStatus(publicClient as any, address);
  } catch {
    return NONE;
  }
}

/**
 * GoodDollar face-verification link for the OLD wallet, so a lapsed user can
 * re-verify the very wallet that holds their identity (it must be that wallet —
 * re-verifying the new one would create a second, separate identity).
 */
export async function generateReverifyLink(
  oldWalletClient: WalletClient,
  oldAddress: string,
  callbackUrl: string,
): Promise<string> {
  const sdk = new IdentitySDK({
    // Checksummed: generateFVLink embeds THIS value in the message the wallet
    // signs and in the link's `account` param. A lowercase address here recovers
    // to the wrong signer on GoodDollar's side → "Login information is missing".
    account: getAddress(oldAddress),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: publicClient as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walletClient: oldWalletClient as any,
    env: "production",
  });
  const link = await sdk.generateFVLink(false, callbackUrl, 42220);
  return typeof link === "string" ? link : (link as unknown as { link: string }).link;
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
