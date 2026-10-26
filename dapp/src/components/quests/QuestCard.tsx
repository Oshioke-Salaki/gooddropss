"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Flame, Gift, RefreshCw, Target, UserPlus } from "lucide-react";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import type { Quest, QuestId } from "@/lib/quests";

interface QuestsResponse {
  weekStart: number;
  weekEnd: number;
  quests: Quest[];
  completedCount: number;
}

const ICON: Record<QuestId, typeof Target> = {
  claim: Target,
  hide: Gift,
  friend: UserPlus,
  streak: Flame,
};

/** "Resets in 3 days" / "Resets tomorrow" / "Resets tonight". */
function resetsIn(weekEnd: number): string {
  const s = weekEnd - Math.floor(Date.now() / 1000);
  const days = Math.floor(s / 86_400);
  if (days >= 2) return `Resets in ${days} days`;
  if (days === 1) return "Resets tomorrow";
  return "Resets tonight";
}

/**
 * This week's three quests on the own-profile page.
 *
 * Purely recognition — nothing here pays out. Refetches (past the short CDN
 * cache) after a claim so progress moves while the person is still looking.
 */
export function QuestCard({ address }: { address: string }) {
  const [data, setData] = useState<QuestsResponse | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback((fresh: boolean) => {
    setError(false);
    const bust = fresh ? `&r=${Date.now()}` : "";
    fetch(`/api/quests?address=${address.toLowerCase()}${bust}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: QuestsResponse) => setData(d))
      .catch(() => setError(true));
  }, [address]);

  useEffect(() => {
    setData(null);
    load(false);
    const onActivity = () => load(true);
    window.addEventListener("gd:streak-updated", onActivity);
    window.addEventListener("gd:claim-success", onActivity);
    window.addEventListener("gd:drop-created", onActivity);
    return () => {
      window.removeEventListener("gd:streak-updated", onActivity);
      window.removeEventListener("gd:claim-success", onActivity);
      window.removeEventListener("gd:drop-created", onActivity);
    };
  }, [load]);

  const allDone = !!data && data.quests.length > 0 && data.completedCount === data.quests.length;

  return (
    <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 min-w-0" aria-labelledby="quests-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="quests-title" className="text-xl/none text-heading">This week</h2>
          <p className="text-sm/none text-nav-muted mt-2">
            {data ? resetsIn(data.weekEnd) : "Resets Monday"}
          </p>
        </div>
        {data ? (
          <span
            className={`shrink-0 h-8 px-3.5 rounded-full text-sm/none flex items-center gap-1.5 ${
              allDone ? "bg-brand text-white" : "bg-surface text-heading"
            }`}
          >
            {allDone && <Check className="w-4 h-4" strokeWidth={2} />}
            {data.completedCount}/{data.quests.length} done
          </span>
        ) : !error ? (
          <Skeleton className="h-8 w-20 shrink-0" />
        ) : null}
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl bg-surface p-4 flex items-center justify-between gap-3">
          <p className="text-sm/[140%] text-nav-muted">Couldn&apos;t load this week&apos;s quests.</p>
          <button
            type="button"
            onClick={() => load(true)}
            className="shrink-0 h-9 px-4 rounded-full bg-white border border-line text-sm/none text-heading
              flex items-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface"
          >
            <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="mt-5 flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-11.5 h-11.5 shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-2 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {allDone && (
            <div className="mt-5 rounded-2xl bg-brand-soft px-4 py-3 text-sm/[140%] text-brand">
              Week complete. New quests arrive on Monday.
            </div>
          )}
          <ul className="mt-5 flex flex-col gap-4">
            {data.quests.map((q) => {
              const Icon = ICON[q.id] ?? Target;
              const pct = Math.round((q.progress / q.target) * 100);
              return (
                <li key={q.id} className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-11.5 h-11.5 shrink-0 rounded-full flex items-center justify-center ${
                      q.done ? "bg-brand text-white" : "bg-surface text-heading"
                    }`}
                  >
                    {q.done ? <Check className="w-5 h-5" strokeWidth={2} /> : <Icon className="w-5 h-5" strokeWidth={1.75} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={`text-base/none truncate ${q.done ? "text-nav-muted line-through decoration-1" : "text-heading"}`}>
                        {q.title}
                      </p>
                      <span className="shrink-0 text-sm/none text-nav-muted tabular-nums">
                        {q.progress}/{q.target}
                      </span>
                    </div>
                    <div
                      className="mt-2.5 h-1.5 rounded-full bg-surface overflow-hidden"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={q.target}
                      aria-valuenow={q.progress}
                      aria-label={q.title}
                    >
                      <div
                        className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 ${q.done ? "bg-brand" : "bg-streak"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-sm/[140%] text-nav-muted mt-2 truncate">{q.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
