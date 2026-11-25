import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getRedis, keys } from "@/lib/redis";
import { listSpots } from "@/lib/spotStore";
import { milliToWei } from "@/lib/spotPayments";
import { spotStatus, SPOT_STATUSES } from "@/lib/spotStatus";
import { gql } from "@/lib/subgraphClient";
import { buildSpotStats, type Approval, type RewardDrop } from "@/lib/spotStats";
import type { SpotPayment } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };
const APPROVAL_LOG_CAP = 1000;   // lib/taskApprove keeps the newest 1000

interface SgDrop { id: string; amount: string; claimer: string; status: number; claimedAt: string; createdAt: string; expiry: string }

// GET /api/admin/spots → GoodSpots numbers: every business with what it has
// taken in G$, its reward drops, and how many people came to it. Admin only,
// strictly read-only. A shop whose running totals were never seeded (its owner
// hasn't opened the dashboard since totals were added) is counted from its list.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503, headers: NO_STORE });

  try {
    const spots = await listSpots(redis, [...SPOT_STATUSES], 5000);

    // Running totals, payment lists and reward ids, in pipelines of 100 shops.
    const payStats = new Map<string, { count: number; wei: bigint }>();
    const paymentLists = new Map<string, SpotPayment[]>();
    const rewardIds = new Map<string, string[]>();
    for (let i = 0; i < spots.length; i += 100) {
      const chunk = spots.slice(i, i + 100);
      const p = redis.pipeline();
      for (const s of chunk) {
        p.hgetall(keys.spotPayStats(s.id));
        p.lrange(keys.spotPayments(s.id), 0, -1);
        p.lrange(keys.taskDropsBySpot(s.id), 0, -1);
      }
      const res = (await p.exec()) as unknown[];
      chunk.forEach((s, j) => {
        const st = (res[j * 3] ?? {}) as Record<string, string | number> | null;
        const raw = (res[j * 3 + 1] ?? []) as (string | SpotPayment)[];
        const list = raw.flatMap((r) => {
          try { return [typeof r === "string" ? (JSON.parse(r) as SpotPayment) : r]; } catch { return []; }
        });
        paymentLists.set(s.id, list);
        payStats.set(s.id, st?.seeded
          ? { count: Number(st.count ?? 0), wei: milliToWei(st.milli ?? 0) }
          : { count: list.length, wei: list.reduce((t, p) => { try { return t + BigInt(p.amount); } catch { return t; } }, 0n) });
        const ids = ((res[j * 3 + 2] ?? []) as (string | number)[]).map(String);
        rewardIds.set(s.id, [...new Set(ids)]);
      });
    }

    // Reward drops as the indexer sees them (amount, who claimed, when).
    const allIds = [...new Set([...rewardIds.values()].flat())].filter((id) => /^\d{1,30}$/.test(id));
    const rewardDrops = new Map<string, RewardDrop>();
    let rewardsOk = true;
    for (let i = 0; i < allIds.length; i += 500) {
      const ids = allIds.slice(i, i + 500);
      try {
        const { drops } = await gql<{ drops: SgDrop[] }>(
          `query R($ids: [ID!]) { drops(first: 1000, where: { id_in: $ids }) { id amount claimer status claimedAt createdAt expiry } }`,
          { ids }, { timeoutMs: 8_000 },
        );
        for (const d of drops) {
          const claimer = d.claimer && !/^0x0{40}$/i.test(d.claimer) ? d.claimer.toLowerCase() : null;
          rewardDrops.set(String(d.id), {
            dropId: String(d.id), amountWei: d.amount, claimer, status: Number(d.status),
            claimedAt: Number(d.claimedAt ?? 0), createdAt: Number(d.createdAt ?? 0), expiry: Number(d.expiry ?? 0),
          });
        }
      } catch (e) {
        console.error("[admin/spots] subgraph", e);
        rewardsOk = false;
      }
    }

    // In-store QR approvals (each one a person standing at the till).
    const rawLog = (await redis.lrange<string | Approval>(keys.taskApprovalLog(), 0, -1)) ?? [];
    const approvals: Approval[] = rawLog.flatMap((r) => {
      try {
        const a = typeof r === "string" ? JSON.parse(r) : r;
        return a && a.spotId && a.root ? [{ ts: Number(a.ts ?? 0), root: String(a.root), spotId: String(a.spotId) }] : [];
      } catch { return []; }
    });

    const stats = buildSpotStats({
      spots, statusOf: spotStatus, payStats, paymentLists, rewardIds, rewardDrops, approvals,
      approvalLogFull: rawLog.length >= APPROVAL_LOG_CAP, nowSec: Math.floor(Date.now() / 1000),
    });
    return NextResponse.json({ ...stats, rewardsOk }, { headers: NO_STORE });
  } catch (e) {
    console.error("[admin/spots]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: NO_STORE });
  }
}
