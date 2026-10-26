// Per-instance memo for expensive server reads (subgraph scans, board builds).
//
// Two things in one: a short TTL so a burst of requests hitting the same warm
// serverless instance reuses one result, and in-flight sharing so N concurrent
// cold requests trigger ONE upstream call instead of N. The CDN sits in front of
// the routes as well; this covers the misses that still reach a function.
//
// A failed load is never cached — the next caller retries — but a stale value,
// if one exists, is served instead of an error, so a subgraph blip degrades to
// "slightly old" rather than "broken".

interface Entry<T> { at: number; value: T }

const values = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>, opts: { fresh?: boolean } = {}): Promise<T> {
  const hit = values.get(key) as Entry<T> | undefined;
  if (!opts.fresh && hit && Date.now() - hit.at < ttlMs) return hit.value;

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const p = load()
    .then((value) => {
      values.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      if (hit) return hit.value; // stale beats failure
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
