"use client";
import { useEffect, useState } from "react";

// The task text of a shop reward ("Buy any coffee"), fetched once per reward and
// shared by every screen that shows it. A task never changes after it's set,
// so the answer is cached for the life of the page. Misses aren't cached, so
// a reward whose task is still being saved shows up on the next look.

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function load(dropId: string): Promise<string | null> {
  const hit = cache.get(dropId);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(dropId);
  if (!p) {
    p = fetch(`/api/task/info?dropId=${dropId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { task?: unknown } | null) => {
        const t = typeof d?.task === "string" && d.task ? d.task : null;
        if (t) cache.set(dropId, t);
        return t;
      })
      .catch(() => null)
      .finally(() => inflight.delete(dropId));
    inflight.set(dropId, p);
  }
  return p;
}

/** Remember a task we already have (e.g. it came back with the reward code). */
export function rememberTask(dropId: string, task: string) {
  if (task) cache.set(dropId, task);
}

/** The task for `dropId`, or null while loading / when there's none. Pass null to skip. */
export function useTaskInfo(dropId: string | null): string | null {
  const [task, setTask] = useState<string | null>(() => (dropId ? cache.get(dropId) ?? null : null));
  useEffect(() => {
    if (!dropId) { setTask(null); return; }
    let alive = true;
    setTask(cache.get(dropId) ?? null);
    load(dropId).then((t) => { if (alive && t) setTask(t); });
    return () => { alive = false; };
  }, [dropId]);
  return task;
}
