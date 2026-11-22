import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { liveStreakDays, type WeekActivity, type WeekBounds } from "@/lib/quests";
import type { Drop, HunterStreak } from "@/types";
import { fetchDropsForAddress } from "@/lib/subgraph";

// Raw numbers for one person's week, for the quests endpoint and the weekly
// recap: this person's claims and drops inside the window, read from the drop
// mirror (lib/subgraph), so the recap's loop over every subscriber costs no
// extra subgraph requests.

const ADDR_RE = /^0x[0-9a-f]{40}$/;

export interface WeekActivityDetail extends WeekActivity {
  root: string;
  /** Sum of G$ claimed in the window, in wei. */
  gFoundWei: bigint;
}

/** This person's claims and drops with timestamps inside [start, end). */
export function windowActivity(drops: Drop[], wallets: string[], week: WeekBounds): { claimed: Drop[]; created: Drop[] } {
  const set = new Set(wallets.map((w) => w.toLowerCase()));
  const inWeek = (t: number) => t >= week.start && t < week.end;
  return {
    claimed: drops.filter((d) => d.status === 1 && set.has(d.claimer.toLowerCase()) && inWeek(d.claimedAt)),
    created: drops.filter((d) => set.has(d.dropper.toLowerCase()) && inWeek(d.createdAt)),
  };
}

export async function fetchWeekActivity(
  redis: Redis | null,
  address: string,
  week: WeekBounds,
  nowS = Math.floor(Date.now() / 1000),
): Promise<WeekActivityDetail> {
  const addr = address.toLowerCase();
  if (!ADDR_RE.test(addr)) throw new Error("invalid address");

  // Identity-scoped like the rest of the app: activity from a linked wallet
  // counts. The root is the canonical wallet, so query both it and the one in use.
  const root = await resolveIdentityRoot(addr).catch(() => addr);
  const wallets = [...new Set([addr, root.toLowerCase()])];

  const [rows, referrals, streakRaw] = await Promise.all([
    fetchDropsForAddress(wallets).then((ds) => windowActivity(ds, wallets, week)),
    redis
      ? redis.zcount(keys.referralCredited(root), week.start, week.end - 1).catch(() => 0)
      : Promise.resolve(0),
    redis ? redis.get<string | HunterStreak>(keys.streak(root)).catch(() => null) : Promise.resolve(null),
  ]);

  const streak: HunterStreak | null =
    streakRaw == null ? null : typeof streakRaw === "string" ? JSON.parse(streakRaw) : streakRaw;

  return {
    root,
    claims: rows.claimed.length,
    gFoundWei: rows.claimed.reduce((sum, d) => sum + d.amount, 0n),
    dropsHidden: rows.created.length,
    referrals: Number(referrals) || 0,
    streak: liveStreakDays(streak, nowS, week),
  };
}
