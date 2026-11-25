import type { Spot, SpotPayment, SpotStatus } from "@/types";

// GoodSpots numbers for the admin. Pure: the route gathers the raw rows (shops,
// their verified payments, their reward drops as the subgraph sees them, and the
// in-store QR approvals) and this folds them into per-shop and overall figures.
//
// Three ways a person "comes to" a shop, all verified:
//   • paid it in G$ (a verified payment to the shop's wallet);
//   • had a reward approved at the till (the merchant scanned their QR);
//   • claimed one of the shop's reward drops.

export interface RewardDrop {
  dropId: string;
  amountWei: string;
  claimer: string | null;   // lowercase, null while unclaimed
  status: number;           // 0 active, 1 claimed, 2 reclaimed/expired
  claimedAt: number;
  createdAt: number;
  expiry: number;
}

export interface Approval { ts: number; root: string; spotId: string }

export interface SpotRow {
  id: string;
  name: string;
  category: string;
  status: SpotStatus;
  place: string;
  createdAt: number;
  payments: number;          // all time (running counter)
  paidWei: string;           // all time (running counter)
  payers: number;            // distinct payers in the stored list
  payments30d: number;
  paidWei30d: string;
  lastPaymentAt: number | null;
  rewards: number;           // reward drops created for this shop
  rewardWei: string;         // G$ put into rewards
  rewardsClaimed: number;
  rewardClaimedWei: string;
  rewardClaimers: number;
  rewardsLive: number;       // unclaimed and not yet expired
  rewardsExpired: number;    // ran out unclaimed (or taken back)
  approvals: number;         // in-store QR approvals (recent log)
  visitors: number;          // distinct people: payers ∪ reward claimers ∪ approved roots
  circulatedWei: string;     // paid to the shop + rewards claimed at it
}

export interface SpotStats {
  at: number;
  businesses: number;
  byStatus: Record<SpotStatus, number>;
  payments: number;
  paidWei: string;
  payments30d: number;
  paidWei30d: string;
  rewards: number;
  rewardWei: string;
  rewardsClaimed: number;
  rewardClaimedWei: string;
  rewardsLive: number;
  rewardsExpired: number;
  approvals: number;
  customers: number;         // distinct payers across every shop
  visitors: number;          // distinct people who came to any shop
  activeWithPayments: number;
  circulatedWei: string;
  approvalLogFull: boolean;  // the approval log only keeps the latest entries
  paymentListCapped: boolean; // some shop has more payments than its stored list
  rows: SpotRow[];
}

const DAY = 86_400;

export function buildSpotStats(input: {
  spots: Spot[];
  statusOf: (s: Spot) => SpotStatus;
  payStats: Map<string, { count: number; wei: bigint }>;
  paymentLists: Map<string, SpotPayment[]>;
  rewardIds: Map<string, string[]>;
  rewardDrops: Map<string, RewardDrop>;
  approvals: Approval[];
  approvalLogFull: boolean;
  nowSec: number;
}): SpotStats {
  const { spots, statusOf, payStats, paymentLists, rewardIds, rewardDrops, approvals, nowSec } = input;
  const since30 = nowSec - 30 * DAY;
  const byStatus: Record<SpotStatus, number> = { active: 0, pending: 0, paused: 0, suspended: 0, rejected: 0 };
  const allPayers = new Set<string>();
  const allVisitors = new Set<string>();
  const approvalsBySpot = new Map<string, Approval[]>();
  for (const a of approvals) {
    const l = approvalsBySpot.get(a.spotId) ?? [];
    l.push(a);
    approvalsBySpot.set(a.spotId, l);
  }

  let tPayments = 0, tPaid = 0n, tPay30 = 0, tPaid30 = 0n, tRewards = 0, tRewardWei = 0n;
  let tClaimed = 0, tClaimedWei = 0n, tApprovals = 0, activeWithPayments = 0, capped = false, tLive = 0, tExpired = 0;

  const rows: SpotRow[] = spots.map((s) => {
    const status = statusOf(s);
    byStatus[status] += 1;
    const ps = payStats.get(s.id) ?? { count: 0, wei: 0n };
    const list = paymentLists.get(s.id) ?? [];
    if (ps.count > list.length) capped = true;

    const payers = new Set<string>();
    const visitors = new Set<string>();
    let pay30 = 0, paid30 = 0n, last: number | null = null;
    for (const p of list) {
      const who = p.payer?.toLowerCase();
      if (who) { payers.add(who); visitors.add(who); allPayers.add(who); allVisitors.add(who); }
      if (p.ts >= since30) { pay30 += 1; try { paid30 += BigInt(p.amount); } catch { /* skip */ } }
      if (last === null || p.ts > last) last = p.ts;
    }

    let rewardWei = 0n, claimedWei = 0n, claimed = 0, live = 0, expired = 0;
    const claimers = new Set<string>();
    const ids = rewardIds.get(s.id) ?? [];
    for (const id of ids) {
      const d = rewardDrops.get(id);
      if (!d) continue;
      const amt = BigInt(d.amountWei || "0");
      rewardWei += amt;
      if (d.status === 1 && d.claimer) {
        claimed += 1;
        claimedWei += amt;
        claimers.add(d.claimer);
        visitors.add(d.claimer);
        allVisitors.add(d.claimer);
      } else if (d.status === 0 && d.expiry > nowSec) live += 1;
      else expired += 1;
    }

    const appr = approvalsBySpot.get(s.id) ?? [];
    for (const a of appr) { const r = a.root.toLowerCase(); visitors.add(r); allVisitors.add(r); }

    tPayments += ps.count; tPaid += ps.wei; tPay30 += pay30; tPaid30 += paid30;
    tRewards += ids.length; tRewardWei += rewardWei; tClaimed += claimed; tClaimedWei += claimedWei;
    tApprovals += appr.length; tLive += live; tExpired += expired;
    if (status === "active" && ps.count > 0) activeWithPayments += 1;

    return {
      id: s.id, name: s.name, category: s.category, status,
      place: s.placeName || `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`,
      createdAt: s.createdAt ?? 0,
      payments: ps.count, paidWei: ps.wei.toString(), payers: payers.size,
      payments30d: pay30, paidWei30d: paid30.toString(), lastPaymentAt: last,
      rewards: ids.length, rewardWei: rewardWei.toString(),
      rewardsClaimed: claimed, rewardClaimedWei: claimedWei.toString(), rewardClaimers: claimers.size,
      rewardsLive: live, rewardsExpired: expired,
      approvals: appr.length, visitors: visitors.size,
      circulatedWei: (ps.wei + claimedWei).toString(),
    };
  });

  rows.sort((a, b) => {
    const d = BigInt(b.circulatedWei) - BigInt(a.circulatedWei);
    if (d !== 0n) return d > 0n ? 1 : -1;
    return b.visitors - a.visitors || b.createdAt - a.createdAt;
  });

  return {
    at: nowSec,
    businesses: spots.length,
    byStatus,
    payments: tPayments, paidWei: tPaid.toString(),
    payments30d: tPay30, paidWei30d: tPaid30.toString(),
    rewards: tRewards, rewardWei: tRewardWei.toString(),
    rewardsClaimed: tClaimed, rewardClaimedWei: tClaimedWei.toString(),
    rewardsLive: tLive, rewardsExpired: tExpired,
    approvals: tApprovals,
    customers: allPayers.size,
    visitors: allVisitors.size,
    activeWithPayments,
    circulatedWei: (tPaid + tClaimedWei).toString(),
    approvalLogFull: input.approvalLogFull,
    paymentListCapped: capped,
    rows,
  };
}
