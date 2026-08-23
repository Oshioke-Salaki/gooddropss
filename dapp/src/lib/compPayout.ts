import { createPublicClient, createWalletClient, http, getAddress, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { getRedis, keys } from "@/lib/redis";
import { normalizePk } from "@/lib/pk";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";
import { getCompConfig, owedWei, windowScoreRange } from "@/lib/competition";

// The reward wallet — GAS_FAUCET_KEY MUST resolve to this address, or we abort.
export const REWARD_WALLET = getAddress("0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605");
const RPC = "https://forno.celo.org";

export interface PayoutResult {
  ok: boolean;
  reason?: string;
  paid: { root: string; wei: string; tx: string }[];
  outstanding: { root: string; wei: string; reason: string }[];
  errors: { root: string; stage: string; error: string }[];
  potWei: string;
  potSpentWei: string;
  walletBalWei: string;   // reward wallet G$ balance
  gasWei: string;         // reward wallet CELO balance (for tx fees)
  lowGas: boolean;        // true when CELO is low enough to threaten payouts
}

// Idempotent, pot-capped payout sweep. Safe to call as often as we like:
//   • A global Redis lock serialises runs (no concurrent money ops).
//   • Per-referrer we only ever send `owed − alreadyPaid`, so re-runs never double-pay.
//   • Accounting is written BEFORE we await the receipt, so a crash between broadcast
//     and confirmation can only ever UNDER-pay (recoverable), never double-pay (loss).
//   • When the wallet is short or the pot is exhausted, the remainder simply stays
//     outstanding and is settled on a later run (the "queue").
export async function runCompPayout(): Promise<PayoutResult> {
  const empty: PayoutResult = { ok: false, paid: [], outstanding: [], errors: [], potWei: "0", potSpentWei: "0", walletBalWei: "0", gasWei: "0", lowGas: false };
  const redis = getRedis();
  if (!redis) return { ...empty, reason: "storage-unavailable" };

  const key = normalizePk(process.env.GAS_FAUCET_KEY);
  if (!key) return { ...empty, reason: "reward-key-missing" };
  const account = privateKeyToAccount(key);
  if (getAddress(account.address) !== REWARD_WALLET) return { ...empty, reason: "key-not-reward-wallet" };

  // Global run lock — only one payout sweep at a time.
  const locked = await redis.set(keys.compPayoutLock(), Date.now(), { nx: true, ex: 300 });
  if (locked !== "OK") return { ...empty, reason: "another-run-in-progress" };

  const paid: PayoutResult["paid"] = [];
  const outstanding: PayoutResult["outstanding"] = [];
  const errors: PayoutResult["errors"] = [];

  const publicClient = createPublicClient({ chain: celo, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: celo, transport: http(RPC) });

  const cfg = await getCompConfig(redis);
  const wr = windowScoreRange(cfg);
  const potWei = BigInt(cfg.potWei);
  let spent = BigInt((await redis.get<string>(keys.compPotSpent())) ?? "0");
  let walletBal = (await publicClient.readContract({
    address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET],
  })) as bigint;
  // CELO on hand for tx fees. If it runs dry, transfers fail to broadcast — those
  // stay outstanding and retry, but we surface the balance so it's caught early.
  const gasWei = await publicClient.getBalance({ address: REWARD_WALLET });
  const LOW_GAS = 5n * 10n ** 15n; // ~0.005 CELO — hundreds of transfers of headroom

  try {
    const roots = (await redis.smembers(keys.compParticipants())) ?? [];

    // Compute each participant's owed/paid, then pay highest-owed first so that,
    // when funds are limited, the biggest legitimately-earned balances settle first.
    const rows = await Promise.all(roots.map(async (root) => {
      const count = await redis.zcount(keys.referralCredited(root), wr.min, wr.max);
      const alreadyPaid = BigInt((await redis.get<string>(keys.compPaid(root))) ?? "0");
      const owed = owedWei(count, cfg);
      return { root, count, alreadyPaid, delta: owed > alreadyPaid ? owed - alreadyPaid : 0n };
    }));
    rows.sort((a, b) => (b.delta > a.delta ? 1 : b.delta < a.delta ? -1 : 0));

    for (const r of rows) {
      const potLeft = potWei - spent;
      if (potLeft <= 0n) break;               // pot depleted → contest over
      if (r.delta <= 0n) continue;

      let amount = r.delta;
      if (amount > potLeft) amount = potLeft;  // never exceed the pot (last-payout clamp)
      if (walletBal < amount) { outstanding.push({ root: r.root, wei: amount.toString(), reason: "wallet-short" }); continue; }

      // Pay the referrer's CURRENT GoodDrops wallet (the one they refer from);
      // fall back to the identity root if none was ever recorded.
      const dest = (await redis.get<string>(keys.compPayoutWallet(r.root))) ?? r.root;
      let to: `0x${string}`;
      try { to = getAddress(dest); } catch { to = getAddress(r.root); }
      let hash: `0x${string}`;
      try {
        hash = await walletClient.writeContract({ address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
      } catch (e) {
        errors.push({ root: r.root, stage: "broadcast", error: (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message });
        continue;                              // nothing sent → retried next run
      }

      // Optimistic accounting (see header): record paid + pot draw-down immediately.
      const newPaid = r.alreadyPaid + amount;
      spent += amount;
      walletBal -= amount;
      await redis.set(keys.compPaid(r.root), newPaid.toString());
      await redis.set(keys.compPotSpent(), spent.toString());
      await redis.lpush(keys.compPayoutLog(), { root: r.root, to, wei: amount.toString(), tx: hash, at: new Date().toISOString(), status: "sent" });
      await redis.ltrim(keys.compPayoutLog(), 0, 499); // keep the audit trail bounded
      paid.push({ root: r.root, wei: amount.toString(), tx: hash });

      try {
        const rcpt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
        if (rcpt.status !== "success") errors.push({ root: r.root, stage: "receipt-reverted", error: hash });
      } catch (e) {
        // Timed out / RPC hiccup — the tx may still land. We keep `paid` bumped so we
        // never re-send; if it truly failed the referrer is under-paid and recoverable.
        errors.push({ root: r.root, stage: "confirm-timeout", error: hash });
      }
    }

    return { ok: true, paid, outstanding, errors, potWei: potWei.toString(), potSpentWei: spent.toString(), walletBalWei: walletBal.toString(), gasWei: gasWei.toString(), lowGas: gasWei < LOW_GAS };
  } finally {
    await redis.del(keys.compPayoutLock());
  }
}
