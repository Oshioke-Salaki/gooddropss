"use client";
import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { analyticsFromJson, type AdminAnalytics, type AdminAnalyticsJson } from "@/lib/adminAnalytics";
import { formatG$ } from "@/lib/utils";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { AdminPage, Card, Hint, SectionTitle, Stat } from "./ui";
import { DropLimitsCard } from "./DropLimitsCard";
import { CashOutsSummary } from "./CashOutsCard";

// G$ circulated uses the app-wide definition in lib/circulation (drops + rewards).

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

/** Admin · Analytics — live numbers from the drop index (via our server) and the contract. */
export function AnalyticsBody() {
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

  // Totals are computed on the server (one small response instead of every
  // drop ever made): counts, G$ and daily charts from the indexer's running
  // totals, per-person numbers from the drop mirror. See /api/admin/analytics.
  const [m, setM] = useState<AdminAnalytics | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/analytics", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Analytics ${r.status}`);
        return analyticsFromJson((j as { analytics: AdminAnalyticsJson }).analytics);
      })
      .then((a) => { if (!cancelled) setM(a); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

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

      <CashOutsSummary />

      <DropLimitsCard />

      <Hint text={error} tone="bad" className="mb-3" />

      {/* Headline. Five across on desktop; on a phone G$ circulated takes the
          full width and the other four sit two by two. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat
          className="col-span-2 lg:col-span-1"
          tone="accent"
          loading={loading}
          label="G$ circulated"
          sub="all drops + rewards"
          value={m ? (Number(m.circulatedWei) / 1e18).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}
        />
        <Stat loading={loading} label="Transactions" sub="drops hidden, claimed, reclaimed" value={m ? m.transactions.toLocaleString("en-US") : ""} />
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
