// Weekly quests — pure logic, no I/O.
//
// Three small goals per week, derived entirely from activity that already
// exists (claims, drops, referral credits, the streak). There is no payout:
// completing the week is recognition, never money, so nothing here can move
// funds. The server gathers the raw numbers (lib/weekActivity) and this module
// turns them into progress.
//
// Weeks run Monday 00:00 → Monday 00:00 in Lagos time (WAT, UTC+1, no DST),
// which is where most players are and when the recap push goes out.

const WAT_OFFSET_S = 3600;
const DAY_S = 86_400;
const WEEK_S = 7 * DAY_S;

export interface WeekBounds {
  /** Unix seconds, inclusive. Monday 00:00 WAT. */
  start: number;
  /** Unix seconds, exclusive. The following Monday 00:00 WAT. */
  end: number;
  /** Monotonic week number — stable id for rotation and per-week markers. */
  index: number;
}

export function weekBounds(nowS: number): WeekBounds {
  const localDay = Math.floor((nowS + WAT_OFFSET_S) / DAY_S);
  // 1970-01-01 was a Thursday; (day + 3) % 7 is 0 on Mondays.
  const mondayDay = localDay - ((localDay + 3) % 7);
  const start = mondayDay * DAY_S - WAT_OFFSET_S;
  return { start, end: start + WEEK_S, index: Math.floor((mondayDay + 3) / 7) };
}

export interface WeekActivity {
  /** Drops claimed in the week. */
  claims: number;
  /** Drops hidden (created) in the week. */
  dropsHidden: number;
  /** Referrals credited to this person in the week. */
  referrals: number;
  /** Current hunting streak in days, already checked to still be alive this week. */
  streak: number;
}

export type QuestId = "claim" | "hide" | "friend" | "streak";

export interface Quest {
  id: QuestId;
  title: string;
  detail: string;
  progress: number;
  target: number;
  done: boolean;
}

const DEFS: Record<QuestId, { title: string; detail: string; target: number; of: (a: WeekActivity) => number }> = {
  claim:  { title: "Claim 2 drops",       detail: "Find two drops on the map this week.",          target: 2, of: (a) => a.claims },
  hide:   { title: "Hide a drop",         detail: "Leave some G$ for someone near you.",            target: 1, of: (a) => a.dropsHidden },
  friend: { title: "Bring a friend",      detail: "Invite someone who claims or hides their first drop.", target: 1, of: (a) => a.referrals },
  streak: { title: "Keep a 3-day streak", detail: "Claim on three days in a row.",                  target: 3, of: (a) => a.streak },
};

// Claiming is the core loop, so it's always on the list; the other two rotate
// through the remaining pairs so the week has some variety.
const ROTATION: [QuestId, QuestId][] = [
  ["hide", "friend"],
  ["hide", "streak"],
  ["friend", "streak"],
];

export function questIdsForWeek(weekIndex: number): QuestId[] {
  const pair = ROTATION[((weekIndex % ROTATION.length) + ROTATION.length) % ROTATION.length];
  return ["claim", ...pair];
}

export function evaluateQuests(weekIndex: number, activity: WeekActivity): Quest[] {
  return questIdsForWeek(weekIndex).map((id) => {
    const d = DEFS[id];
    const raw = Math.max(0, Math.floor(d.of(activity) || 0));
    const progress = Math.min(raw, d.target);
    return { id, title: d.title, detail: d.detail, progress, target: d.target, done: progress >= d.target };
  });
}

/**
 * A streak only counts toward this week if it's still alive: its last claim
 * day (YYYY-MM-DD, UTC, as stored by /api/engagement) is today or yesterday
 * and falls inside the week.
 */
export function liveStreakDays(
  streak: { current: number; lastDate: string } | null,
  nowS: number,
  week: WeekBounds,
): number {
  if (!streak?.lastDate || !(streak.current > 0)) return 0;
  const last = Date.parse(`${streak.lastDate}T00:00:00Z`) / 1000;
  if (!Number.isFinite(last)) return 0;
  const today = Math.floor(nowS / DAY_S) * DAY_S;
  const alive = last >= today - DAY_S;
  // The last claim day must overlap the week (its UTC day ends after the week starts).
  const inWeek = last + DAY_S > week.start && last < week.end;
  return alive && inWeek ? streak.current : 0;
}
