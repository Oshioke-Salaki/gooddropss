"use client";
import { useEffect, useMemo, useState } from "react";
import { useDrops } from "@/hooks/useDrops";
import { resolveRoots } from "@/lib/roots";
import { DROP_STATUS } from "@/types";
import type { Rank } from "./components/types";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Builds both leaderboards from the subgraph.
 *
 * Entries are grouped by GoodDollar identity ROOT, so someone who migrated
 * wallets is one row rather than two. Each group still displays the wallet they
 * actually use — the most recently active member — so the row shows a current
 * address and the username attached to it.
 *
 * `rootsLoading` matters: until roots resolve, every wallet is its own group, so
 * the board would render un-merged and then visibly re-shuffle. The page keeps
 * skeletons up through that window.
 */
export function useLeaderboard() {
  const { drops, fetchDrops } = useDrops();
  const [roots, setRoots] = useState<Map<string, string>>(new Map());
  const [rootsLoading, setRootsLoading] = useState(true);
  // useDrops starts with loading=false and an empty array, so trusting its flag
  // would render the empty state for a frame before the first fetch even starts.
  // This only flips once that fetch has actually settled.
  const [dropsLoaded, setDropsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDrops().finally(() => { if (!cancelled) setDropsLoaded(true); });
    return () => { cancelled = true; };
  }, [fetchDrops]);

  useEffect(() => {
    if (!dropsLoaded) return;
    if (drops.length === 0) { setRootsLoading(false); return; }

    const addrs = new Set<string>();
    for (const d of drops) {
      addrs.add(d.dropper.toLowerCase());
      if (d.claimer !== ZERO) addrs.add(d.claimer.toLowerCase());
    }

    let cancelled = false;
    setRootsLoading(true);
    resolveRoots([...addrs])
      .then((m) => { if (!cancelled) setRoots(m); })
      .catch(() => { /* resolveRoots never throws, but don't hang on a surprise */ })
      .finally(() => { if (!cancelled) setRootsLoading(false); });
    return () => { cancelled = true; };
  }, [drops, dropsLoaded]);

  const board = useMemo(() => {
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

    const toRanks = (map: Map<string, Agg>): Rank[] =>
      Array.from(map.values())
        .map(({ wei, count, displayAddr }) => ({ address: displayAddr, totalWei: wei, count }))
        // Ties broken by count then address, so the order is stable across
        // renders instead of depending on Map insertion order.
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
  }, [drops, roots]);

  return { ...board, loading: !dropsLoaded || rootsLoading, refresh: fetchDrops };
}
