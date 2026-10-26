import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { resolveRoots } from "@/lib/roots";

// Same fail-fast policy as /api/profile — profiles are cosmetic, so a Redis blip
// should degrade to "no username", never hang the page.
const redis = Redis.fromEnv({ retry: { retries: 1, backoff: () => 300 } });

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX = 500;

type Stored = { username: string; createdAt: number } | null;

/**
 * POST /api/profile/batch  { addresses: string[] }
 *   → { profiles: { [lowercased address]: { username, createdAt } | null } }
 *
 * The leaderboard needs a name for every ranked wallet at once — to render, and
 * to search by. Done one-by-one that's a request per row; here it's one batched
 * multicall for the identity roots plus one or two Redis mgets, whatever the
 * list size.
 *
 * Mirrors the single-address GET exactly, including the legacy fallback: names
 * set on a LINKED wallet before usernames were identity-scoped are keyed by that
 * wallet, so a root miss re-checks the wallet itself.
 */
export async function POST(req: NextRequest) {
  let body: { addresses?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (!Array.isArray(body.addresses)) {
    return NextResponse.json({ error: "addresses[] required" }, { status: 400 });
  }

  const addrs = [
    ...new Set(
      body.addresses
        .filter((a): a is string => typeof a === "string" && ADDR_RE.test(a))
        .map((a) => a.toLowerCase()),
    ),
  ].slice(0, MAX);

  const profiles: Record<string, Stored> = {};
  if (addrs.length === 0) return NextResponse.json({ profiles });

  try {
    // Cached + batched; repeated leaderboard loads only multicall new wallets.
    const roots = await resolveRoots(addrs);
    const rootOf = (a: string) => roots.get(a) ?? a;

    const uniqRoots = [...new Set(addrs.map(rootOf))];
    const rootValues = await redis.mget<Stored[]>(...uniqRoots.map((r) => `gd:profile:${r}`));
    const byRoot = new Map<string, Stored>(uniqRoots.map((r, i) => [r, rootValues[i] ?? null]));

    // Legacy fallback, only for linked wallets whose root has no name — same
    // condition as the single GET, so one extra mget at most.
    const legacy = addrs.filter((a) => rootOf(a) !== a && !byRoot.get(rootOf(a)));
    if (legacy.length > 0) {
      const values = await redis.mget<Stored[]>(...legacy.map((a) => `gd:profile:${a}`));
      legacy.forEach((a, i) => {
        if (values[i]) profiles[a] = values[i];
      });
    }

    for (const a of addrs) {
      if (!(a in profiles)) profiles[a] = byRoot.get(rootOf(a)) ?? null;
    }

    return NextResponse.json({ profiles });
  } catch (e) {
    console.error("[profile/batch]", e);
    // Degrade to "nobody has a name" rather than failing the whole page.
    for (const a of addrs) profiles[a] = null;
    return NextResponse.json({ profiles });
  }
}
