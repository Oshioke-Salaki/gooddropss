import { NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { getEvent, hostDropsFor, statsFor } from "@/lib/eventStore";
import { resolveRoots } from "@/lib/roots";
import { isEventId, publicEvent, statsToJson } from "@/lib/events";
import { DROP_STATUS } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const ZERO = "0x0000000000000000000000000000000000000000";
const G = 10n ** 18n;

/**
 * GET /api/events/:id/report — everything a host shows a sponsor after the
 * event: the headline stats, finds hour by hour, and every person who found
 * G$ (one row per person across their wallets). All of it is public on-chain
 * data about a public event; nothing private is added.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isEventId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const e = await getEvent(redis, id);
  if (!e || (e.status !== "approved" && e.status !== "cancelled")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const now = Math.floor(Date.now() / 1000);
    const [stats, interested, drops] = await Promise.all([statsFor([e], now), redis.scard(keys.eventInterested(id)), hostDropsFor(e)]);

    const claimed = drops.filter((d) => d.status === DROP_STATUS.Claimed && d.claimer !== ZERO);
    const roots = claimed.length ? await resolveRoots([...new Set(claimed.map((d) => d.claimer.toLowerCase()))]) : new Map<string, string>();

    // Finds per hour, from the first hour of the event to the last find.
    const hourly = new Map<number, { claims: number; wei: bigint }>();
    const people = new Map<string, { address: string; claims: number; wei: bigint; latest: number }>();
    for (const d of claimed) {
      const at = d.claimedAt || 0;
      const h = Math.floor(at / 3600) * 3600;
      const cur = hourly.get(h) ?? { claims: 0, wei: 0n };
      hourly.set(h, { claims: cur.claims + 1, wei: cur.wei + d.amount });
      const root = roots.get(d.claimer.toLowerCase()) ?? d.claimer.toLowerCase();
      const p = people.get(root);
      const newer = !p || at >= p.latest;
      people.set(root, {
        address: newer ? d.claimer.toLowerCase() : p!.address,
        claims: (p?.claims ?? 0) + 1, wei: (p?.wei ?? 0n) + d.amount, latest: Math.max(p?.latest ?? 0, at),
      });
    }
    const hours = [...hourly.entries()].sort((a, b) => a[0] - b[0])
      .map(([at, v]) => ({ at, claims: v.claims, g: Number(v.wei / (G / 100n)) / 100 }));
    const hunters = [...people.values()]
      .sort((a, b) => (b.wei === a.wei ? b.claims - a.claims : b.wei > a.wei ? 1 : -1))
      .slice(0, 50)
      .map((p) => ({ address: p.address, claims: p.claims, wei: p.wei.toString() }));
    const unclaimedWei = drops
      .filter((d) => d.status === DROP_STATUS.Active)
      .reduce((s, d) => s + d.amount, 0n);
    const reclaimedWei = drops
      .filter((d) => d.status === DROP_STATUS.Reclaimed)
      .reduce((s, d) => s + d.amount, 0n);

    return NextResponse.json(
      {
        event: publicEvent(e),
        stats: statsToJson(stats.get(id)!), interested, hours, hunters,
        unclaimedWei: unclaimedWei.toString(), reclaimedWei: reclaimedWei.toString(), at: Date.now(),
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[events/report]", err);
    return NextResponse.json({ error: "Couldn't build the report" }, { status: 502 });
  }
}
