// Real-world wiring for lib/firstDrop: the chain, the indexer and the reward
// wallet. Kept apart so the rules can be tested without any of them.
//
// Server only.

import { createPublicClient, createWalletClient, http, getAddress, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { getRedis, keys } from "@/lib/redis";
import { normalizePk } from "@/lib/pk";
import { G_TOKEN_ADDRESS, GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { isVerifiedHuman, resolveIdentityRootStrict } from "@/lib/identityRoot";
import { fetchDropsForAddress } from "@/lib/subgraph";
import { getBoardSnapshot } from "@/lib/boardSnapshot";
import { REWARD_WALLET } from "@/lib/refPayout";
import { runFirstDropPayout, type BonusSender, type DropLite, type FirstDropDeps, type FirstDropPayoutResult } from "@/lib/firstDrop";

const RPC = "https://forno.celo.org";
const publicClient = createPublicClient({ chain: celo, transport: http(RPC) });

export function firstDropDeps(): FirstDropDeps {
  return {
    isVerified: isVerifiedHuman,
    resolveRoot: resolveIdentityRootStrict,
    async dropsOf(wallet, root) {
      // This wallet, fresh from the indexer, plus any other wallet of theirs
      // the leaderboard has already linked to the same person.
      const [own, snap] = await Promise.all([
        fetchDropsForAddress(wallet, { fresh: true }),
        getBoardSnapshot(),
      ]);
      const out = new Map<string, DropLite>();
      for (const d of own) {
        if (d.dropper.toLowerCase() === wallet) out.set(d.id.toString(), { id: d.id.toString(), dropper: d.dropper.toLowerCase(), createdAt: d.createdAt });
      }
      for (const d of snap.drops) {
        const by = d.dropper.toLowerCase();
        if ((snap.roots.get(by) ?? by) === root || by === root) {
          out.set(d.id.toString(), { id: d.id.toString(), dropper: by, createdAt: d.createdAt });
        }
      }
      return [...out.values()];
    },
    async readDrop(dropId) {
      const d = (await publicClient.readContract({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(dropId)],
      })) as { dropper: string };
      return d && !/^0x0{40}$/i.test(d.dropper) ? { dropper: d.dropper } : null;
    },
  };
}

function rewardSender(): BonusSender | null {
  const key = normalizePk(process.env.GAS_FAUCET_KEY);
  if (!key) return null;
  const account = privateKeyToAccount(key);
  if (getAddress(account.address) !== REWARD_WALLET) return null;
  const wallet = createWalletClient({ account, chain: celo, transport: http(RPC) });
  return {
    balance: async () => (await publicClient.readContract({
      address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET],
    })) as bigint,
    transfer: (to, wei) => wallet.writeContract({
      address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [getAddress(to), wei],
    }),
  };
}

export async function payFirstDropBonuses(): Promise<FirstDropPayoutResult> {
  const redis = getRedis();
  if (!redis) return { ok: false, reason: "storage-unavailable", paid: [], waiting: 0, errors: [] };
  const sender = rewardSender();
  if (!sender) return { ok: false, reason: "reward-key-missing", paid: [], waiting: 0, errors: [] };
  // Same lock as referral payouts: one sender of the reward wallet at a time.
  return runFirstDropPayout(redis, sender, keys.refPayoutLock());
}

/** Fire-and-forget from request paths: never throws, one short retry if a payout run holds the lock. */
export async function tryFirstDropPayout(): Promise<void> {
  try {
    let r = await payFirstDropBonuses();
    if (r.reason === "another-run-in-progress") {
      await new Promise((ok) => setTimeout(ok, 3000));
      r = await payFirstDropBonuses();
    }
    if (!r.ok && r.reason !== "another-run-in-progress") console.warn("[firstDrop] payout skipped:", r.reason);
    if (r.errors.length) console.error("[firstDrop] payout errors", r.errors);
  } catch (e) {
    console.error("[firstDrop] payout failed", e);
  }
}
