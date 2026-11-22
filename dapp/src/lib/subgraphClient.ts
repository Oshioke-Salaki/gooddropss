// The one way the server talks to the Goldsky subgraph.
//
// Goldsky's Starter plan allows 20 requests per 10 seconds for the WHOLE project,
// so every request counts. This adds what plain fetch() lacked:
//   • a timeout, so a hung indexer can't hold a serverless function open;
//   • a short retry with backoff for blips, rate limits (429) and 5xx, honouring
//     Retry-After, but never retrying a bad query;
//   • GraphQL errors surfaced as errors (a 200 with `errors` used to read as "no rows").

export const SUBGRAPH_URL = process.env.SUBGRAPH_URL || process.env.NEXT_PUBLIC_SUBGRAPH_URL || "";

export class SubgraphError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SubgraphError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  { timeoutMs = 10_000, retries = 2 }: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  if (!SUBGRAPH_URL) throw new SubgraphError("Subgraph URL is not set");
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const ra = (lastErr as { retryAfterMs?: number } | undefined)?.retryAfterMs;
      // 400ms, 1.2s (+ up to 250ms jitter), or what the server asked for (max 5s).
      await sleep(Math.min(5_000, ra ?? 400 * 3 ** (attempt - 1) + Math.random() * 250));
    }
    let res: Response;
    try {
      res = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = new SubgraphError(`Subgraph unreachable: ${(e as Error).message}`);
      continue; // network error or timeout: worth one more try
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      lastErr = Object.assign(new SubgraphError(`Subgraph ${res.status}`, res.status), {
        retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined,
      });
      continue;
    }
    if (!res.ok) throw new SubgraphError(`Subgraph ${res.status}`, res.status);
    let json: { data?: T; errors?: { message: string }[] };
    try { json = await res.json(); } catch { throw new SubgraphError("Subgraph sent an unreadable answer"); }
    if (json.errors?.length) throw new SubgraphError(json.errors[0].message);
    if (!json.data) throw new SubgraphError("Subgraph sent no data");
    return json.data;
  }
  throw lastErr instanceof Error ? lastErr : new SubgraphError("Subgraph request failed");
}
