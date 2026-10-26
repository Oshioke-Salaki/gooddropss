import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { liveStreakDays, type WeekActivity, type WeekBounds } from "@/lib/quests";
import type { HunterStreak } from "@/types";

// Raw numbers for one person's week, for the quests endpoint and the weekly
// recap. Deliberately narrow: two filtered subgraph queries (this person's
// claims and drops inside the window) instead of paging the whole drop history.

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";
const ADDR_RE = /^0x[0-9a-f]{40}$/;

export interface WeekActivityDetail extends WeekActivity {
  root: string;
  /** Sum of G$ claimed in the window, in wei. */
  gFoundWei: bigint;
}

interface Row { amount: string }

async function windowRows(wallets: string[], week: WeekBounds): Promise<{ claimed: Row[]; created: Row[] }> {
  if (!SUBGRAPH_URL) return { claimed: [], created: [] };
  const list = JSON.stringify(wallets);
  // `status: 1` = Claimed. 1000 is far beyond what one person does in a week;
  // it only bounds a pathological account.
  const query = `{
    claimed: drops(first: 1000, where: { claimer_in: ${list}, status: 1, claimedAt_gte: "${week.start}", claimedAt_lt: "${week.end}" }) { amount }
    created: drops(first: 1000, where: { dropper_in: ${list}, createdAt_gte: "${week.start}", createdAt_lt: "${week.end}" }) { amount }
  }`;
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`subgraph ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return { claimed: json.data?.claimed ?? [], created: json.data?.created ?? [] };
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
    windowRows(wallets, week),
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
    gFoundWei: rows.claimed.reduce((s, r) => s + BigInt(r.amount || "0"), 0n),
    dropsHidden: rows.created.length,
    referrals: Number(referrals) || 0,
    streak: liveStreakDays(streak, nowS, week),
  };
}
