import { DROP_STATUS, type Drop } from "@/types";

const ZERO = "0x0000000000000000000000000000000000000000";

/** One ranked identity. Wallets linked to the same GoodDollar root collapse into one. */
export interface BoardRank {
  /** The wallet this person actually uses — the most recently active of the group. */
  address: string;
  totalWei: bigint;
  /** Drops created (droppers) or drops claimed (hunters). */
  count: number;
}

export interface Board {
  droppers: BoardRank[];
  hunters: BoardRank[];
  droppedWei: bigint;
  claimedWei: bigint;
  totalDrops: number;
  totalClaims: number;
}

/**
 * Both leaderboards from the full drop set.
 *
 * Entries are grouped by GoodDollar identity ROOT (`roots`: address → root), so
 * someone who migrated wallets is one row rather than two. Each group displays
 * the wallet they actually use — the most recently active member. Ties break by
 * count, then address, so the order is stable.
 *
 * Pure and deterministic: the server builds it once and every client gets the
 * same ranking, instead of every phone downloading the whole drop history to
 * compute it.
 */
export function buildBoard(drops: Drop[], roots: Map<string, string>): Board {
  type Agg = { wei: bigint; count: number; displayAddr: string; latest: number };
  const hunterMap = new Map<string, Agg>();
  const dropperMap = new Map<string, Agg>();
  let claimedWei = 0n;
  let droppedWei = 0n;
  let claimCount = 0;

  const keyOf = (addr: string) => roots.get(addr.toLowerCase()) ?? addr.toLowerCase();

  const bump = (map: Map<string, Agg>, key: string, wallet: string, amount: bigint, when: number) => {
    const prev = map.get(key);
    if (!prev) { map.set(key, { wei: amount, count: 1, displayAddr: wallet, latest: when }); return; }
    const newer = when >= prev.latest;
    map.set(key, {
      wei: prev.wei + amount,
      count: prev.count + 1,
      displayAddr: newer ? wallet : prev.displayAddr,
      latest: newer ? when : prev.latest,
    });
  };

  for (const drop of drops) {
    bump(dropperMap, keyOf(drop.dropper), drop.dropper.toLowerCase(), drop.amount, drop.createdAt || 0);
    droppedWei += drop.amount;

    if (drop.status === DROP_STATUS.Claimed && drop.claimer !== ZERO) {
      bump(hunterMap, keyOf(drop.claimer), drop.claimer.toLowerCase(), drop.amount,
           drop.claimedAt || drop.createdAt || 0);
      claimedWei += drop.amount;
      claimCount += 1;
    }
  }

  const toRanks = (map: Map<string, Agg>): BoardRank[] =>
    Array.from(map.values())
      .map(({ wei, count, displayAddr }) => ({ address: displayAddr, totalWei: wei, count }))
      .sort((a, b) =>
        a.totalWei === b.totalWei
          ? b.count - a.count || a.address.localeCompare(b.address)
          : b.totalWei > a.totalWei ? 1 : -1,
      );

  return {
    droppers: toRanks(dropperMap),
    hunters: toRanks(hunterMap),
    droppedWei,
    claimedWei,
    totalDrops: drops.length,
    totalClaims: claimCount,
  };
}

// ── Wire format ────────────────────────────────────────────────────────────────

export interface BoardJson {
  droppers: { address: string; totalWei: string; count: number }[];
  hunters: { address: string; totalWei: string; count: number }[];
  droppedWei: string;
  claimedWei: string;
  totalDrops: number;
  totalClaims: number;
  /** Unix ms the board was computed. */
  at: number;
}

export function boardToJson(b: Board, at: number): BoardJson {
  const ranks = (rs: BoardRank[]) => rs.map((r) => ({ address: r.address, totalWei: r.totalWei.toString(), count: r.count }));
  return {
    droppers: ranks(b.droppers),
    hunters: ranks(b.hunters),
    droppedWei: b.droppedWei.toString(),
    claimedWei: b.claimedWei.toString(),
    totalDrops: b.totalDrops,
    totalClaims: b.totalClaims,
    at,
  };
}

export function boardFromJson(j: BoardJson): Board {
  const ranks = (rs: BoardJson["hunters"]) => rs.map((r) => ({ address: r.address, totalWei: BigInt(r.totalWei), count: r.count }));
  return {
    droppers: ranks(j.droppers),
    hunters: ranks(j.hunters),
    droppedWei: BigInt(j.droppedWei),
    claimedWei: BigInt(j.claimedWei),
    totalDrops: j.totalDrops,
    totalClaims: j.totalClaims,
  };
}
