"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Nav, BottomNav } from "@/components/Nav";
import { useDrops } from "@/hooks/useDrops";
import { formatG$ } from "@/lib/utils";
import { UserHandle } from "@/components/UserHandle";
import { DROP_STATUS } from "@/types";
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
}: {
  rank: number;
  entry: Rank;
  label?: string;
}) {
  const isTop3 = rank <= 3;
  return (
    <div
      className={clsx(
        "flex items-center gap-3 border-2 border-ink rounded-2xl px-3 py-3 min-w-0",
        isTop3 ? RANK_STYLES[rank - 1] : "bg-card"
      )}
    >
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
        <div className="font-bold text-sm truncate"><UserHandle address={entry.address} /></div>
        <div className="text-xs opacity-70 font-medium">{entry.count} {label}</div>
      </Link>
      <div className="text-right shrink-0">
        <div className="font-black text-lg leading-none">{formatG$(entry.totalWei)}</div>
        <div className="text-xs opacity-70 font-semibold">G$</div>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { drops, loading, fetchDrops } = useDrops();
  const [tab, setTab] = useState<"hunters" | "droppers">("hunters");

  useEffect(() => {
    fetchDrops();
  }, [fetchDrops]);

  const { hunters, droppers, totalG$, totalDrops } = useMemo(() => {
    const hunterMap = new Map<string, { wei: bigint; count: number }>();
    const dropperMap = new Map<string, { wei: bigint; count: number }>();
    let totalG$ = 0n;

    for (const drop of drops) {
      const dk = drop.dropper.toLowerCase();
      const prev = dropperMap.get(dk) ?? { wei: 0n, count: 0 };
      dropperMap.set(dk, { wei: prev.wei + drop.amount, count: prev.count + 1 });

      if (
        drop.status === DROP_STATUS.Claimed &&
        drop.claimer !== "0x0000000000000000000000000000000000000000"
      ) {
        const ck = drop.claimer.toLowerCase();
        const prevC = hunterMap.get(ck) ?? { wei: 0n, count: 0 };
        hunterMap.set(ck, { wei: prevC.wei + drop.amount, count: prevC.count + 1 });
        totalG$ += drop.amount;
      }
    }

    const toRanks = (map: Map<string, { wei: bigint; count: number }>): Rank[] =>
      Array.from(map.entries())
        .map(([address, { wei, count }]) => ({
          address,
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
  }, [drops]);

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
