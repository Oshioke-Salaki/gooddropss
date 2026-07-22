"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { useDrops } from "@/hooks/useDrops";
import { formatG$ } from "@/lib/utils";
import { resolveRoots } from "@/lib/roots";
import { UserHandle } from "@/components/UserHandle";
import { useProfile } from "@/hooks/useProfile";
import { DROP_STATUS } from "@/types";
import type { HunterStreak } from "@/types";
import clsx from "clsx";

interface Rank {
  address: string;
  totalWei: bigint;
  count: number;
}

const RANK_STYLES = [
  "bg-lime border-ink text-ink shadow-brutal",
  "bg-ink border-ink text-lime shadow-brutal",
  "bg-border border-ink text-ink",
];

function RankRow({
  rank,
  entry,
  label,
  streak,
  showNameNudge,
}: {
  rank: number;
  entry: Rank;
  label?: string;
  streak?: HunterStreak | null;
  showNameNudge?: boolean;
}) {
  const isTop3 = rank <= 3;
  return (
    <div
      className={clsx(
        "border-2 border-ink rounded-2xl px-3 py-3 min-w-0",
        isTop3 ? RANK_STYLES[rank - 1] : "bg-card"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0",
            rank === 1 && "bg-ink text-lime",
            rank === 2 && "bg-lime text-ink",
            rank >= 3 && !isTop3
              ? "bg-border text-muted"
              : rank === 3
              ? "bg-cream text-ink border border-ink"
              : ""
          )}
        >
          {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank}
        </div>
        <Link href={`/hunter/${entry.address}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
          <div className="font-bold text-sm truncate flex items-center gap-1.5">
            <UserHandle address={entry.address} />
            {streak && streak.current >= 2 && (
              <span
                title={`${streak.current}-day streak`}
                className={clsx(
                  "text-xs font-black px-1.5 py-0.5 rounded-full border leading-none shrink-0",
                  streak.current >= 7
                    ? "bg-orange-500 border-orange-700 text-white"
                    : "bg-cream border-ink text-ink"
                )}
              >
                🔥{streak.current}
              </span>
            )}
          </div>
          <div className="text-xs opacity-70 font-medium">{entry.count} {label}</div>
        </Link>
        <div className="text-right shrink-0">
          <div className="font-black text-lg leading-none">{formatG$(entry.totalWei)}</div>
          <div className="text-xs opacity-70 font-semibold">G$</div>
        </div>
      </div>

      {showNameNudge && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("gd:setName"))}
          className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full bg-lime border-2 border-ink text-ink shadow-brutal-sm hover:opacity-90 transition-opacity"
        >
          👋 That&apos;s you — claim your name →
        </button>
      )}
    </div>
  );
}

export default function LeaderboardPage() {
  const { drops, loading, fetchDrops } = useDrops();
  const { address: me } = useAccount();
  const myProfile = useProfile(me);
  // Show the "that's you — claim your name" nudge only once we've confirmed the
  // connected user has no username yet.
  const iNeedName = !!me && myProfile !== undefined && !myProfile?.username;
  const [tab, setTab] = useState<"hunters" | "droppers">("hunters");
  const [streaks, setStreaks] = useState<Record<string, HunterStreak>>({});
  // Map each wallet → its identity root, so a person's linked wallets collapse
  // into one leaderboard entry (no double-counting migrated users).
  const [roots, setRoots] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    fetchDrops();
  }, [fetchDrops]);

  // Resolve identity roots for every participating wallet once drops are in.
  useEffect(() => {
    if (drops.length === 0) return;
    const addrs = new Set<string>();
    for (const d of drops) {
      addrs.add(d.dropper.toLowerCase());
      if (d.claimer !== "0x0000000000000000000000000000000000000000") addrs.add(d.claimer.toLowerCase());
    }
    let cancelled = false;
    resolveRoots([...addrs]).then((m) => { if (!cancelled) setRoots(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [drops]);

  const { hunters, droppers, totalG$, totalDrops } = useMemo(() => {
    // Group/dedup by identity ROOT so a migrated person is one entry, but track a
    // `displayAddr` = the wallet they actually use (the most-recently-active member
    // of the group). For a migrated user that's their GoodDrops wallet, not the old
    // Focus-Pet root — so the row shows their current address and its username.
    type Agg = { wei: bigint; count: number; displayAddr: string; latest: number };
    const hunterMap = new Map<string, Agg>();
    const dropperMap = new Map<string, Agg>();
    let totalG$ = 0n;
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

      if (
        drop.status === DROP_STATUS.Claimed &&
        drop.claimer !== "0x0000000000000000000000000000000000000000"
      ) {
        bump(hunterMap, keyOf(drop.claimer), drop.claimer.toLowerCase(), drop.amount, drop.claimedAt || drop.createdAt || 0);
        totalG$ += drop.amount;
      }
    }

    const toRanks = (map: Map<string, Agg>): Rank[] =>
      Array.from(map.values())
        .map(({ wei, count, displayAddr }) => ({
          address: displayAddr,
          totalWei: wei,
          count,
        }))
        .sort((a, b) => (b.totalWei > a.totalWei ? 1 : -1));

    return {
      hunters: toRanks(hunterMap),
      droppers: toRanks(dropperMap),
      totalG$,
      totalDrops: drops.length,
    };
  }, [drops, roots]);

  // Fetch streaks for top 20 hunters once the list is computed
  useEffect(() => {
    const top = hunters.slice(0, 20);
    if (top.length === 0) return;
    Promise.allSettled(
      top.map((h) =>
        fetch(`/api/engagement?address=${h.address}`)
          .then((r) => r.json())
          .then((d) => ({ address: h.address.toLowerCase(), streak: d.streak as HunterStreak | null }))
      )
    ).then((results) => {
      const map: Record<string, HunterStreak> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.streak) {
          map[r.value.address] = r.value.streak;
        }
      }
      setStreaks(map);
    });
  }, [hunters]);

  return (
    <div className="min-h-screen bg-cream pb-24">
      <Nav />

      <div className="max-w-screen-md mx-auto px-4 pt-20 pb-8">
        <h1 className="text-3xl font-black tracking-tight mb-1">Rankings 🏆</h1>
        <p className="text-muted text-sm mb-6">
          Real-time leaderboard
        </p>

        {/* Global stats */}
        <div className="grid grid-cols-3 gap-2 mb-6 min-w-0">
          <div className="bg-card border-2 border-ink rounded-2xl p-3 text-center shadow-brutal-sm">
            <div className="text-xl font-black">{totalDrops}</div>
            <div className="text-xs text-muted font-semibold mt-0.5">Total Drops</div>
          </div>
          <div className="bg-lime border-2 border-ink rounded-2xl p-3 text-center shadow-brutal">
            <div className="text-xl font-black">{formatG$(totalG$)}</div>
            <div className="text-xs font-bold mt-0.5">G$ Claimed</div>
          </div>
          <div className="bg-card border-2 border-ink rounded-2xl p-3 text-center shadow-brutal-sm">
            <div className="text-xl font-black">{hunters.length}</div>
            <div className="text-xs text-muted font-semibold mt-0.5">Hunters</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-2 border-ink rounded-xl overflow-hidden mb-5">
          {(["hunters", "droppers"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "flex-1 py-3 text-sm font-bold capitalize transition-colors",
                tab === t
                  ? "bg-ink text-lime"
                  : "bg-cream text-muted hover:bg-border"
              )}
            >
              {t === "hunters" ? "🎯 Hunters" : "💰 Droppers"}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-border rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {(tab === "hunters" ? hunters : droppers).length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <div className="text-5xl">{tab === "hunters" ? "🎯" : "💰"}</div>
                <p className="font-bold">No data yet</p>
                <p className="text-sm text-muted">
                  {tab === "hunters"
                    ? "Be the first to claim a drop!"
                    : "Be the first to create a drop!"}
                </p>
              </div>
            ) : (
              (tab === "hunters" ? hunters : droppers).map((entry, i) => (
                <RankRow
                  key={entry.address}
                  rank={i + 1}
                  entry={entry}
                  label={tab === "hunters" ? "claims" : "drops"}
                  streak={tab === "hunters" ? (streaks[entry.address.toLowerCase()] ?? null) : null}
                  showNameNudge={iNeedName && entry.address.toLowerCase() === me?.toLowerCase()}
                />
              ))
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
