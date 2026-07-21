"use client";
import { useEffect, useState } from "react";
import { fetchAllDrops } from "@/lib/subgraph";
import { DROP_STATUS } from "@/types";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Global rank card by total G$ claimed. Computed client-side so it never slows
 * the server-rendered profile — it pops in once the subgraph responds. Ranks by
 * claimer address (matches this profile's own claimed total).
 */
export function HunterRank({ address }: { address: string }) {
  const [rank, setRank] = useState<{ pos: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllDrops()
      .then((all) => {
        const byHunter = new Map<string, bigint>();
        for (const d of all) {
          if (d.status === DROP_STATUS.Claimed && d.claimer && d.claimer.toLowerCase() !== ZERO) {
            const k = d.claimer.toLowerCase();
            byHunter.set(k, (byHunter.get(k) ?? 0n) + d.amount);
          }
        }
        const sorted = [...byHunter.entries()].sort((a, b) =>
          b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
        );
        const idx = sorted.findIndex(([k]) => k === address.toLowerCase());
        if (!cancelled && idx >= 0) setRank({ pos: idx + 1, total: sorted.length });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [address]);

  if (!rank) return null;

  const medal = rank.pos === 1 ? "🥇" : rank.pos === 2 ? "🥈" : rank.pos === 3 ? "🥉" : "🎯";

  return (
    <div className="bg-ink text-lime border-2 border-ink rounded-2xl p-4 text-center shadow-brutal">
      <p className="text-2xl font-black leading-none">
        {medal} #{rank.pos}
      </p>
      <p className="text-[11px] font-bold uppercase tracking-wide mt-1.5 text-lime/70">
        Global rank · of {rank.total} hunters
      </p>
    </div>
  );
}
