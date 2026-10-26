"use client";
import { useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { fetchAllDrops } from "@/lib/subgraph";
import { resolveRoots } from "@/lib/roots";
import { formatG$ } from "@/lib/utils";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { DROP_STATUS, type Drop } from "@/types";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { AdminPage, Card, Hint, SectionTitle, Stat } from "./ui";

const ZERO = "0x0000000000000000000000000000000000000000";

// Manual adjustment: G$ paid out of the reward wallet (0x4412…6605) counts as
// circulation but isn't in the subgraph (they're plain G$ transfers). This is the
// full on-chain outflow from that wallet, matching Dune:
//   Misc/early                75  (Mar 19–22)
//   Week-1 prizes        478,632  (Aug 1–2: hunters 239,316 + droppers 239,316)
//   Reward transfer      200,000  (Aug 6 → 0x4f649e…3091)
//   Sprint prizes        498,000  (Aug 21 top-10: 200k+120k+80k + 7×14k)
//   Ambassador funding   500,000  (Aug 24–27: circulation G$ sent to ambassadors)
//   Big Drop prizes    1,000,000  (Sep 8 top-10: 200k+120k+105k+90k+85k + 5×80k)
//   Social campaign      400,000  (Sep 8: 4 winners × 100k)
//   ──────────────────────────────
//   Total              3,076,707  ← equals the reward wallet's TOTAL on-chain
//                                   G$ outflow, so this reconciles with Dune.
// Verify any time with the Blockscout token-transfer list for 0x4412…6605:
// (sum of transfers OUT). in − out should equal the wallet's current balance.
const PRIZE_G_DISTRIBUTED = 3_076_707n * 10n ** 18n;

function fmtDuration(sec: number): string {
  if (sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const mn = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mn}m`;
  return `${mn}m`;
}

/** 14 bars, tallest fills the box. `tone` picks the bar colour. */
function Bars({
  days, tone = "brand",
}: { days: { day: string; label: string; ratio: number }[]; tone?: "brand" | "streak" }) {
  const fill = tone === "brand" ? "bg-brand" : "bg-streak";
  return (
    <div className="flex items-end gap-1.5 lg:gap-2 h-[140px]">
      {days.map(({ day, label, ratio }) => (
        <div key={day} className="flex-1 min-w-0 flex flex-col items-center gap-1.5 h-full justify-end" title={`${day}: ${label || 0}`}>
          <span className="text-[10px]/none text-nav-muted truncate max-w-full">{label}</span>
          <div
            className={`w-full rounded-full ${ratio > 0 ? fill : "bg-surface"}`}
            style={{ height: `${Math.max(4, ratio * 96)}px` }}
          />
          <span className="text-[10px]/none text-nav-muted/70">{day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

/** Admin · Analytics — live numbers from the subgraph and the contract. */
export function AnalyticsBody() {
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [roots, setRoots] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");

  const { data: totalLocked } = useReadContract({
    address: GOOD_DROPS_ADDRESS,
    abi: GOOD_DROPS_ABI,
    functionName: "totalLocked",
  });
  const { data: identityRequired } = useReadContract({
    address: GOOD_DROPS_ADDRESS,
    abi: GOOD_DROPS_ABI,
    functionName: "identityRequired",
  });

  useEffect(() => {
    let cancelled = false;
    fetchAllDrops()
      .then((d) => {
        if (!cancelled) setDrops(d);
        return d;
      })
      .then((d) => {
        const addrs = new Set<string>();
        for (const x of d) {
          addrs.add(x.dropper.toLowerCase());
          if (x.claimer !== ZERO) addrs.add(x.claimer.toLowerCase());
        }
        return resolveRoots([...addrs]);
      })
      .then((m) => {
        if (!cancelled) setRoots(m);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const m = useMemo(() => {
    if (!drops) return null;
    const now = Math.floor(Date.now() / 1000);
    const rootOf = (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase();

    let claimedWei = 0n, reclaimedWei = 0n, activeWei = 0n;
    let active = 0, claimed = 0, reclaimed = 0, expiredUnclaimed = 0;
    const droppers = new Set<string>();
    const hunters = new Set<string>();
    const humans = new Set<string>();
    const perDay: Record<string, number> = {};
    const claimedWeiPerDay: Record<string, bigint> = {};
    const todayStr = new Date().toISOString().slice(0, 10);
    const activeToday = new Set<string>();
    let ttcSum = 0, ttcCount = 0;

    for (const d of drops) {
      droppers.add(rootOf(d.dropper));
      humans.add(rootOf(d.dropper));
      const day = new Date(d.createdAt * 1000).toISOString().slice(0, 10);
      perDay[day] = (perDay[day] ?? 0) + 1;

      if (d.status === DROP_STATUS.Claimed) {
        claimed++;
        claimedWei += d.amount;
        if (d.claimer !== ZERO) {
          hunters.add(rootOf(d.claimer));
          humans.add(rootOf(d.claimer));
        }
        if (d.claimedAt > 0 && d.createdAt > 0 && d.claimedAt >= d.createdAt) {
          ttcSum += d.claimedAt - d.createdAt;
          ttcCount++;
        }
        if (d.claimedAt > 0) {
          const cday = new Date(d.claimedAt * 1000).toISOString().slice(0, 10);
          claimedWeiPerDay[cday] = (claimedWeiPerDay[cday] ?? 0n) + d.amount;
          if (cday === todayStr && d.claimer !== ZERO) activeToday.add(rootOf(d.claimer));
        }
      } else if (d.status === DROP_STATUS.Reclaimed) {
        reclaimed++;
        reclaimedWei += d.amount;
      } else {
        active++;
        activeWei += d.amount;
        if (d.expiry < now) expiredUnclaimed++;
      }
    }

    const settled = claimed + reclaimed;
    const claimRate = settled > 0 ? Math.round((claimed / settled) * 100) : 0;

    // Last 14 days of drop creation.
    const days: { day: string; n: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push({ day, n: perDay[day] ?? 0 });
    }
    const maxDay = Math.max(1, ...days.map((x) => x.n));

    // Last 14 days of G$ CLAIMED (velocity), and average time from drop → find.
    const claimedDays: { day: string; wei: bigint }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      claimedDays.push({ day, wei: claimedWeiPerDay[day] ?? 0n });
    }
    const maxClaimedWei = claimedDays.reduce((mx, x) => (x.wei > mx ? x.wei : mx), 1n);
    const avgTtcSec = ttcCount ? Math.round(ttcSum / ttcCount) : 0;

    return {
      total: drops.length, active, claimed, reclaimed, expiredUnclaimed,
      claimedWei, reclaimedWei, activeWei,
      circulatedWei: claimedWei + PRIZE_G_DISTRIBUTED, // claims + competition prizes
      droppers: droppers.size, hunters: hunters.size, humans: humans.size,
      claimRate, days, maxDay, activeToday: activeToday.size, avgTtcSec, claimedDays, maxClaimedWei,
    };
  }, [drops, roots]);

  const loading = !m;
  const protection = identityRequired === undefined ? "loading" : identityRequired === true ? "on" : "off";

  return (
    <AdminPage title="Analytics" subtitle="Live from the subgraph and the contract." width="max-w-[1040px]">
      {/* Security posture — the single most important operational flag. */}
      <div
        role="status"
        className={`flex items-center gap-3 rounded-2xl px-5 py-4 mb-6 text-sm/[140%] ${
          protection === "loading" ? "bg-white border border-line text-nav-muted"
          : protection === "on" ? "bg-brand-soft text-brand"
          : "bg-[#FFEBEB] text-danger"
        }`}
      >
        {protection === "loading"
          ? <Loader2 className="w-5 h-5 animate-spin shrink-0" />
          : protection === "on"
            ? <ShieldCheck className="w-5 h-5 shrink-0" strokeWidth={1.75} />
            : <TriangleAlert className="w-5 h-5 shrink-0" strokeWidth={1.75} />}
        {protection === "loading"
          ? "Checking claim protection…"
          : protection === "on"
            ? "Identity required to claim. Sybil-protected."
            : "Identity NOT required: claims are open to anyone (farmable). Call setIdentityRequired(true)."}
      </div>

      <Hint text={error} tone="bad" className="mb-3" />

      {/* Headline */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          tone="accent"
          loading={loading}
          label="G$ circulated"
          sub="claims"
          value={m ? (Number(m.circulatedWei) / 1e18).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}
        />
        <Stat loading={loading} label="Unique humans" sub="deduped by identity" value={m ? String(m.humans) : ""} />
        <Stat loading={loading} label="Hunters" sub="claimed ≥ 1 drop" value={m ? String(m.hunters) : ""} />
        <Stat loading={loading} label="Droppers" sub="created ≥ 1 drop" value={m ? String(m.droppers) : ""} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <Stat loading={loading} label="Total drops" value={m ? String(m.total) : ""} />
        <Stat loading={loading} label="Active" sub={m ? `${m.expiredUnclaimed} expired unclaimed` : undefined} value={m ? String(m.active) : ""} />
        <Stat loading={loading} label="Claimed" sub={m ? `${m.claimRate}% claim rate` : undefined} value={m ? String(m.claimed) : ""} />
        <Stat loading={loading} label="Reclaimed" value={m ? String(m.reclaimed) : ""} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <Stat
          loading={loading}
          label="G$ locked now"
          sub="in live drops"
          value={m ? (totalLocked !== undefined ? formatG$(totalLocked as bigint) : formatG$(m.activeWei)) : ""}
        />
        <Stat loading={loading} label="G$ reclaimed" sub="returned to droppers" value={m ? formatG$(m.reclaimedWei) : ""} />
        <Stat tone="accent" loading={loading} label="Active today" sub="hunters who claimed today" value={m ? String(m.activeToday) : ""} />
        <Stat loading={loading} label="Avg time-to-claim" sub="drop created → found" value={m ? fmtDuration(m.avgTtcSec) : ""} />
      </div>

      {/* Drops created — last 14 days */}
      <Card className="mt-6">
        <SectionTitle className="mb-5">Drops created · last 14 days</SectionTitle>
        {m ? (
          <Bars days={m.days.map(({ day, n }) => ({ day, label: n ? String(n) : "", ratio: n / m.maxDay }))} />
        ) : (
          <Skeleton className="h-[140px] rounded-2xl" />
        )}
      </Card>

      {/* G$ claimed — last 14 days (velocity) */}
      <Card className="mt-4">
        <SectionTitle className="mb-5">G$ claimed · last 14 days</SectionTitle>
        {m ? (
          <Bars
            tone="streak"
            days={m.claimedDays.map(({ day, wei }) => ({
              day,
              label: wei > 0n ? formatG$(wei) : "",
              ratio: Number((wei * 1000n) / m.maxClaimedWei) / 1000,
            }))}
          />
        ) : (
          <Skeleton className="h-[140px] rounded-2xl" />
        )}
      </Card>
    </AdminPage>
  );
}
