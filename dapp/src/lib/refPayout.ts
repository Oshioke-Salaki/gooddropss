import { createPublicClient, createWalletClient, http, getAddress, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { getRedis, keys } from "@/lib/redis";
import { normalizePk } from "@/lib/pk";
import { G_TOKEN_ADDRESS } from "@/lib/contracts";
import { getRefCompConfig, type RefCompConfig } from "@/lib/competition";
import { computeReferralBoard } from "@/lib/competitionReferral";

// The reward wallet — GAS_FAUCET_KEY MUST resolve to this address, or we abort.
export const REWARD_WALLET = getAddress("0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605");
const RPC = "https://forno.celo.org";
const LOW_GAS = 5n * 10n ** 15n; // ~0.005 CELO — hundreds of transfers of headroom

export interface RefPayoutResult {
  ok: boolean;
  reason?: string;
  paid: { root: string; to: string; wei: string; tx: string }[];
  outstanding: { root: string; wei: string; reason: string }[];
  errors: { root: string; stage: string; error: string }[];
  potWei: string;
  potSpentWei: string;
  walletBalWei: string;
  gasWei: string;
  lowGas: boolean;
}

const EMPTY: RefPayoutResult = {
  ok: false, paid: [], outstanding: [], errors: [],
  potWei: "0", potSpentWei: "0", walletBalWei: "0", gasWei: "0", lowGas: false,
};

/**
 * Pay everyone what the referral board says they've earned but haven't received.
 *
 * Idempotent and safe to call as often as we like — it runs after every credited
 * referral and from the daily cron as a safety net.
 *
 *   • A global Redis lock serialises runs, so two callers can't pay at once.
 *   • Per referrer we only ever send `earned − alreadyPaid`, so a re-run is a no-op.
 *   • Accounting is written the instant the transfer BROADCASTS, before we await
 *     the receipt. A crash in between can only ever UNDER-pay (recoverable on the
 *     next run) — never double-pay, which isn't.
 *   • Paying a referral locks its pot slot permanently (see rule 4 in
 *     competitionReferral.ts), so nobody who has been paid can later be displaced
 *     and the pot can't be overspent.
 *   • A short wallet or an exhausted pot leaves the remainder outstanding; the
 *     next run settles it. Nothing is ever partially paid within one referrer.
 *
 * Scoped to the REFERRAL competition only. The points competition is unchanged
 * and still pays by script.
 */
export async function runRefPayout(): Promise<RefPayoutResult> {
  const redis = getRedis();
  if (!redis) return { ...EMPTY, reason: "storage-unavailable" };

  const key = normalizePk(process.env.GAS_FAUCET_KEY);
  if (!key) return { ...EMPTY, reason: "reward-key-missing" };
  const account = privateKeyToAccount(key);
  if (getAddress(account.address) !== REWARD_WALLET) {
    return { ...EMPTY, reason: "key-not-reward-wallet" };
  }

  const cfg: RefCompConfig = await getRefCompConfig(redis);

  // One sweep at a time. 300s covers the slowest realistic run; if a process dies
  // mid-sweep the lock expires rather than wedging payouts forever.
  const locked = await redis.set(keys.refPayoutLock(), Date.now(), { nx: true, ex: 300 });
  if (locked !== "OK") return { ...EMPTY, reason: "another-run-in-progress" };

  const paid: RefPayoutResult["paid"] = [];
  const outstanding: RefPayoutResult["outstanding"] = [];
  const errors: RefPayoutResult["errors"] = [];

  try {
    const publicClient = createPublicClient({ chain: celo, transport: http(RPC) });
    const walletClient = createWalletClient({ account, chain: celo, transport: http(RPC) });

    const board = await computeReferralBoard(cfg);
    const potWei = BigInt(cfg.potWei);
    const per = BigInt(cfg.perReferralWei);
    let spent = BigInt((await redis.get<string>(keys.refPotSpent(cfg.id))) ?? "0");
    let walletBal = (await publicClient.readContract({
      address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET],
    })) as bigint;
    const gasWei = await publicClient.getBalance({ address: REWARD_WALLET });

    const snapshot = () => ({
      potWei: potWei.toString(),
      potSpentWei: spent.toString(),
      walletBalWei: walletBal.toString(),
      gasWei: gasWei.toString(),
      lowGas: gasWei < LOW_GAS,
    });

    // Who is owed what, and exactly which slots that payment settles.
    const rows = await Promise.all(
      board.entries
        .filter((e) => e.unlocked)
        .map(async (e) => {
          const alreadyPaid = BigInt((await redis.get<string>(keys.refPaid(cfg.id, e.root))) ?? "0");
          const earned = BigInt(e.earnedWei);
          const newSlots = e.invitees.filter((i) => i.covered).map((i) => `${e.root}|${i.root}`);
          // Earliest covered referral — used to order payment when funds are short,
          // so the person who earned first is settled first.
          const firstAt = e.invitees.filter((i) => i.covered).reduce((m, i) => (m === 0 ? i.at : Math.min(m, i.at)), 0);
          return {
            root: e.root,
            delta: earned > alreadyPaid ? earned - alreadyPaid : 0n,
            alreadyPaid,
            slots: newSlots,
            firstAt,
          };
        }),
    );
    rows.sort((a, b) => a.firstAt - b.firstAt || a.root.localeCompare(b.root));

    for (const r of rows) {
      if (r.delta <= 0n) continue;

      const potLeft = potWei - spent;
      if (potLeft <= 0n) {
        outstanding.push({ root: r.root, wei: r.delta.toString(), reason: "pot-exhausted" });
        continue;
      }

      // The board already caps coverage at the pot's slot count, so this clamp is
      // belt-and-braces — it can only ever bind if the stored spend and the board
      // disagree, and then we under-pay rather than overspend.
      const amount = r.delta > potLeft ? potLeft : r.delta;

      if (walletBal < amount) {
        outstanding.push({ root: r.root, wei: amount.toString(), reason: "wallet-short" });
        continue;
      }

      // Pay the wallet they actually use in GoodDrops, not the identity root —
      // paying the root is what sent a previous winner's prize to the wrong place.
      const dest = (await redis.get<string>(keys.compPayoutWallet(r.root))) ?? r.root;
      let to: `0x${string}`;
      try { to = getAddress(dest); } catch { to = getAddress(r.root); }

      let hash: `0x${string}`;
      try {
        hash = await walletClient.writeContract({
          address: G_TOKEN_ADDRESS, abi: erc20Abi, functionName: "transfer", args: [to, amount],
        });
      } catch (e) {
        // Nothing left the wallet — leave it unpaid and retry on the next run.
        errors.push({
          root: r.root, stage: "broadcast",
          error: (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message,
        });
        continue;
      }

      // Broadcast succeeded: record before awaiting the receipt (see header).
      const newPaid = r.alreadyPaid + amount;
      spent += amount;
      walletBal -= amount;
      await redis.set(keys.refPaid(cfg.id, r.root), newPaid.toString());
      await redis.set(keys.refPotSpent(cfg.id), spent.toString());
      // Lock the slots this payment settled. Only the ones covered by the amount
      // actually sent, so a clamped payment can't lock slots it didn't pay for.
      const slotsPaid = per > 0n ? Number(newPaid / per) : r.slots.length;
      const lock = r.slots.slice(0, Math.min(slotsPaid, r.slots.length));
      if (lock.length) await redis.sadd(keys.refPaidSlots(cfg.id), lock[0], ...lock.slice(1));
      await redis.lpush(keys.refPayoutLog(cfg.id), {
        root: r.root, to, wei: amount.toString(), tx: hash, at: new Date().toISOString(), status: "sent",
      });
      await redis.ltrim(keys.refPayoutLog(cfg.id), 0, 499);
      paid.push({ root: r.root, to, wei: amount.toString(), tx: hash });

      try {
        const rcpt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
        if (rcpt.status !== "success") errors.push({ root: r.root, stage: "receipt-reverted", error: hash });
      } catch {
        // Timed out or RPC hiccup — the tx may still land. We keep the accounting
        // bumped so we never re-send; a genuine failure under-pays, which is fixable.
        errors.push({ root: r.root, stage: "confirm-timeout", error: hash });
      }
    }

    return { ok: true, paid, outstanding, errors, ...snapshot() };
  } finally {
    await redis.del(keys.refPayoutLock());
  }
}

/**
 * Fire a payout sweep without letting it affect the caller.
 *
 * Used from the referral-credit paths so money moves the moment someone crosses
 * the threshold. Crediting a referral must never fail because a transfer did, so
 * every error is swallowed — the daily cron settles anything missed.
 */
export async function tryRefPayout(): Promise<void> {
  try {
    const res = await runRefPayout();
    if (!res.ok && res.reason && res.reason !== "another-run-in-progress") {
      console.warn("[refPayout] skipped:", res.reason);
    }
  } catch (e) {
    console.error("[refPayout] failed", e);
  }
}
