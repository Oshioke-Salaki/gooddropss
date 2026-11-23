// Server only. The real-world inputs to the referral ledger (lib/referralLedger),
// kept apart so the ledger itself can be tested without a chain or an indexer.

import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRootStrict, isVerifiedHuman } from "@/lib/identityRoot";
import { fetchHasActivity, fetchFirstActivityAt } from "@/lib/subgraph";
import { getCompConfig, inCompWindow, getRefCompConfig, inRefCompWindow } from "@/lib/competition";
import { tryRefPayout } from "@/lib/refPayout";
import type { LedgerDeps } from "@/lib/referralLedger";

/**
 * @param payout settle the referral competition's prizes right after a new
 *   referral (the inline routes). The sweep passes false and pays once at the end.
 */
export function ledgerDeps({ payout = true }: { payout?: boolean } = {}): LedgerDeps {
  return {
    resolveRoot: resolveIdentityRootStrict,
    isVerified: isVerifiedHuman,
    // Fresh: a settle usually follows a claim by seconds, so don't read a stale copy.
    hasActivity: (a) => fetchHasActivity(a, { fresh: true }),
    firstActivityAt: (l) => fetchFirstActivityAt(l, { fresh: true }),
    async onCredited({ account, at }) {
      const redis = getRedis();
      if (!redis) return;
      // Enrol the referrer in whichever competitions are live at the credit time.
      // The two run independently, so a referral can count toward both, one or neither.
      try {
        const [cfg, refCfg] = await Promise.all([getCompConfig(redis), getRefCompConfig(redis)]);
        const enrol: Promise<unknown>[] = [];
        if (inCompWindow(cfg, at)) enrol.push(redis.sadd(keys.compReferrers(cfg.id), account));
        if (inRefCompWindow(refCfg, at)) enrol.push(redis.sadd(keys.compReferrers(refCfg.id), account));
        if (enrol.length) await Promise.all(enrol);
      } catch (e) { console.error("[referral/enrol]", e); }
      // Prizes pay out continuously. Never throws; the daily cron sweeps leftovers.
      if (payout) await tryRefPayout();
    },
  };
}
