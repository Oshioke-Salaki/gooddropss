import type { HunterStreak } from "@/types";

const dayStr = (ms: number) => new Date(ms).toISOString().split("T")[0];

/**
 * The streak as it stands right now.
 *
 * Storage only changes on a claim, so a streak someone abandoned weeks ago is
 * still saved with its old `current`. Read through this so it reads 0 once the
 * chain is broken: a streak is alive only if the last claim was today or
 * yesterday, on the same UTC calendar the claim handler writes with. `best` is
 * kept — that's history, not a live count.
 */
export function effectiveStreak(s: HunterStreak, nowMs = Date.now()): HunterStreak {
  if (!s.lastDate || s.current <= 0) return { ...s, current: 0 };
  const alive = s.lastDate === dayStr(nowMs) || s.lastDate === dayStr(nowMs - 86_400_000);
  return alive ? s : { ...s, current: 0 };
}
