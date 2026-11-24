// "G$ circulated", one definition for the whole app (team's definition, Oct 2026):
//   every G$ hidden in a drop (on-chain, from the Goldsky subgraph)
//   + G$ paid out in competition and campaign rewards (competition wallet,
//     0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605).
// Public pages show only the total; never break out the rewards part.
//
// Rewards come in two parts:
//   • REWARDS_BASE_G: prizes paid by hand. When the team pays one, raise it.
//   • autoRewardsG(): everything the app pays by itself, read live, so the
//     total rises with every payment: referral competition payouts (each
//     competition's running spend) and first-drop bonuses.

import { getRedis, keys } from "@/lib/redis";

// 3,700,000 to 27 Oct 2026 (includes the September referral competition)
// + 85,000 (late September prize, paid 20 Nov). Referral competitions from
// November on are counted live, not here.
export const REWARDS_BASE_G = 3_785_000;
export const REWARDS_BASE_WEI = BigInt(REWARDS_BASE_G) * 10n ** 18n;

/** Referral competitions already inside REWARDS_BASE_G: never count them twice. */
export const COUNTED_BY_HAND = new Set(["referrals-2026-09-10"]);

/**
 * Live rewards can only go up, so if Redis can't be read we never show less
 * than what had been paid when this was written (24 Nov 2026: 427,200 G$ of
 * November referral payouts).
 */
export const AUTO_REWARDS_FLOOR_G = 427_200;

/** Whole G$ circulated, given whole G$ dropped and the live rewards. */
export function circulatedG(droppedG: number, autoG: number): number {
  return droppedG + REWARDS_BASE_G + autoG;
}

/** Sum of the pieces, in whole G$ (pure, for tests). */
export function sumAutoRewardsG(spentWeiByComp: Record<string, string | number | null>, firstDropG: number): number {
  let wei = 0n;
  for (const [id, v] of Object.entries(spentWeiByComp)) {
    if (COUNTED_BY_HAND.has(id) || v == null) continue;
    try { wei += BigInt(typeof v === "number" ? Math.trunc(v).toString() : v); } catch { /* bad value: skip */ }
  }
  return Math.max(AUTO_REWARDS_FLOOR_G, Number(wei / 10n ** 18n) + Math.max(0, Math.trunc(firstDropG || 0)));
}

/** Rewards the app has paid by itself, whole G$. Server only. Never throws. */
export async function autoRewardsG(): Promise<number> {
  const redis = getRedis();
  if (!redis) return AUTO_REWARDS_FLOOR_G;
  try {
    const prefix = keys.refPotSpent("");
    const spentKeys: string[] = [];
    let cur: string | number = 0;
    do {
      const [next, ks]: [string | number, string[]] = await redis.scan(cur, { match: `${prefix}*`, count: 200 });
      cur = next; spentKeys.push(...ks);
    } while (String(cur) !== "0");
    const values = spentKeys.length ? await redis.mget<(string | number | null)[]>(...spentKeys) : [];
    const byComp: Record<string, string | number | null> = {};
    spentKeys.forEach((k, i) => { byComp[k.slice(prefix.length)] = values[i]; });
    const fd = Number((await redis.get<string | number>(keys.firstDropPaidG())) ?? 0);
    return sumAutoRewardsG(byComp, fd);
  } catch (e) {
    console.warn("[circulation] live rewards unavailable", e);
    return AUTO_REWARDS_FLOOR_G;
  }
}
