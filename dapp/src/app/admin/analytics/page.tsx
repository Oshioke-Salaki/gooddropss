"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { Loader2 } from "lucide-react";
import { Nav } from "@/components/Nav";
import { fetchAllDrops } from "@/lib/subgraph";
import { resolveRoots } from "@/lib/roots";
import { formatG$ } from "@/lib/utils";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { DROP_STATUS, type Drop } from "@/types";
import { isAdminAddress } from "@/lib/admins";

// Admin wallets live in one shared allowlist — see lib/admins.ts.
const ZERO  = "0x0000000000000000000000000000000000000000";

function fmtDuration(sec: number): string {
  if (sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const mn = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mn}m`;
  return `${mn}m`;
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? "#BFFD00" : "#fff",
      border: "2.5px solid #111", borderRadius: 16,
      boxShadow: "3px 3px 0 #111", padding: "16px 18px",
    }}>
      <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? "#333" : "#888", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);

  const [drops, setDrops]   = useState<Drop[] | null>(null);
  const [roots, setRoots]   = useState<Map<string, string>>(new Map());
  const [error, setError]   = useState("");

  const { data: totalLocked }      = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "totalLocked" });
  const { data: identityRequired } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "identityRequired" });

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchAllDrops()
      .then((d) => { if (!cancelled) setDrops(d); return d; })
      .then((d) => {
        const addrs = new Set<string>();
        for (const x of d) {
          addrs.add(x.dropper.toLowerCase());
          if (x.claimer !== ZERO) addrs.add(x.claimer.toLowerCase());
        }
        return resolveRoots([...addrs]);
      })
      .then((m) => { if (!cancelled) setRoots(m); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const m = useMemo(() => {
    if (!drops) return null;
    const now = Math.floor(Date.now() / 1000);
    const rootOf = (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase();

    let claimedWei = 0n, reclaimedWei = 0n, activeWei = 0n;
    let active = 0, claimed = 0, reclaimed = 0, expiredUnclaimed = 0;
    const droppers = new Set<string>();
    const hunters  = new Set<string>();
    const humans   = new Set<string>();
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
        claimed++; claimedWei += d.amount;
        if (d.claimer !== ZERO) { hunters.add(rootOf(d.claimer)); humans.add(rootOf(d.claimer)); }
        if (d.claimedAt > 0 && d.createdAt > 0 && d.claimedAt >= d.createdAt) {
          ttcSum += d.claimedAt - d.createdAt; ttcCount++;
        }
        if (d.claimedAt > 0) {
          const cday = new Date(d.claimedAt * 1000).toISOString().slice(0, 10);
          claimedWeiPerDay[cday] = (claimedWeiPerDay[cday] ?? 0n) + d.amount;
          if (cday === todayStr && d.claimer !== ZERO) activeToday.add(rootOf(d.claimer));
        }
      } else if (d.status === DROP_STATUS.Reclaimed) {
        reclaimed++; reclaimedWei += d.amount;
      } else {
        active++; activeWei += d.amount;
        if (d.expiry < now) expiredUnclaimed++;
      }
    }

    const settled = claimed + reclaimed;
    const claimRate = settled > 0 ? Math.round((claimed / settled) * 100) : 0;

    // Last 14 days of drop creation for the sparkline.
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
      droppers: droppers.size, hunters: hunters.size, humans: humans.size,
      claimRate, days, maxDay,
      activeToday: activeToday.size, avgTtcSec, claimedDays, maxClaimedWei,
    };
  }, [drops, roots]);

  if (!isAdmin) {
    return (
      <div style={{ minHeight: "100dvh", background: "#f5f4f0" }}>
        <Nav />
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "100px 20px", textAlign: "center", fontFamily: "'Space Grotesk', sans-serif" }}>
          <div style={{ fontSize: 48 }}>🔒</div>
          <p style={{ fontWeight: 900, fontSize: 20 }}>Admin only</p>
          <p style={{ color: "#888" }}>{address ? "This wallet isn't authorised." : "Connect the admin wallet."}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <Nav />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "84px 18px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Analytics</h1>
          <Link href="/admin" style={{ fontSize: 13, fontWeight: 800, color: "#111", textDecoration: "underline" }}>
            ← Seed drops
          </Link>
        </div>
        <p style={{ color: "#5a5a5a", fontSize: 14, marginBottom: 20 }}>Live from the subgraph + contract.</p>

        {/* Security posture — the single most important operational flag.
            Three states: loading (neutral), protected (dark/lime), open (red). */}
        {(() => {
          const loading   = identityRequired === undefined;
          const protectedOn = identityRequired === true;
          const bg     = loading ? "#f0efe9" : protectedOn ? "#111" : "#FFE5E5";
          const fg     = loading ? "#888"    : protectedOn ? "#BFFD00" : "#C81E1E";
          const border = loading ? "#ddd"    : protectedOn ? "#111" : "#FF3B3B";
          return (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              background: bg, color: fg, border: `2.5px solid ${border}`,
              borderRadius: 14, padding: "13px 16px", marginBottom: 20, fontWeight: 800, fontSize: 13.5,
            }}>
              {loading
                ? <Loader2 size={18} className="animate-spin" style={{ flexShrink: 0 }} />
                : <span style={{ fontSize: 20 }}>{protectedOn ? "🛡️" : "⚠️"}</span>}
              {loading
                ? "Checking claim protection…"
                : protectedOn
                  ? "Identity required to claim — Sybil-protected ✓"
                  : "Identity NOT required — claims are open to anyone (farmable). Call setIdentityRequired(true)."}
            </div>
          );
        })()}

        {error && <p style={{ color: "#C81E1E", fontWeight: 700 }}>{error}</p>}
        {!m ? (
          <div style={{ textAlign: "center", padding: 60, color: "#888", fontWeight: 700 }}>Loading on-chain data…</div>
        ) : (
          <>
            {/* Headline row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 12 }}>
              <Stat label="G$ circulated" value={`${formatG$(m.claimedWei)}`} sub="claimed by hunters" accent />
              <Stat label="Unique humans" value={String(m.humans)} sub="deduped by identity" />
              <Stat label="Hunters" value={String(m.hunters)} sub="claimed ≥ 1 drop" />
              <Stat label="Droppers" value={String(m.droppers)} sub="created ≥ 1 drop" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 12 }}>
              <Stat label="Total drops" value={String(m.total)} />
              <Stat label="Active" value={String(m.active)} sub={`${m.expiredUnclaimed} expired unclaimed`} />
              <Stat label="Claimed" value={String(m.claimed)} sub={`${m.claimRate}% claim rate`} />
              <Stat label="Reclaimed" value={String(m.reclaimed)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
              <Stat label="G$ locked now" value={totalLocked !== undefined ? formatG$(totalLocked as bigint) : formatG$(m.activeWei)} sub="in live drops" />
              <Stat label="G$ reclaimed" value={formatG$(m.reclaimedWei)} sub="returned to droppers" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
              <Stat label="Active today" value={String(m.activeToday)} sub="hunters who claimed today" accent />
              <Stat label="Avg time-to-claim" value={fmtDuration(m.avgTtcSec)} sub="drop created → found" />
            </div>

            {/* Drops created — last 14 days */}
            <div style={{ background: "#fff", border: "2.5px solid #111", borderRadius: 16, boxShadow: "3px 3px 0 #111", padding: "18px 20px" }}>
              <p style={{ margin: "0 0 14px", fontWeight: 900, fontSize: 15 }}>Drops created — last 14 days</p>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
                {m.days.map(({ day, n }) => (
                  <div key={day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title={`${day}: ${n}`}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#888" }}>{n || ""}</div>
                    <div style={{
                      width: "100%", borderRadius: "4px 4px 0 0",
                      background: n > 0 ? "#BFFD00" : "#eee",
                      border: n > 0 ? "1.5px solid #111" : "1.5px solid #e0e0e0",
                      height: `${Math.max(3, (n / m.maxDay) * 92)}px`,
                    }} />
                    <div style={{ fontSize: 9, color: "#aaa" }}>{day.slice(8)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* G$ claimed — last 14 days (velocity) */}
            <div style={{ background: "#fff", border: "2.5px solid #111", borderRadius: 16, boxShadow: "3px 3px 0 #111", padding: "18px 20px", marginTop: 16 }}>
              <p style={{ margin: "0 0 14px", fontWeight: 900, fontSize: 15 }}>G$ claimed — last 14 days</p>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
                {m.claimedDays.map(({ day, wei }) => {
                  const h = Number((wei * 92n) / m.maxClaimedWei);
                  return (
                    <div key={day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title={`${day}: ${formatG$(wei)} G$`}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: "#888" }}>{wei > 0n ? formatG$(wei) : ""}</div>
                      <div style={{
                        width: "100%", borderRadius: "4px 4px 0 0",
                        background: wei > 0n ? "#00CFFF" : "#eee",
                        border: wei > 0n ? "1.5px solid #111" : "1.5px solid #e0e0e0",
                        height: `${Math.max(3, h)}px`,
                      }} />
                      <div style={{ fontSize: 9, color: "#aaa" }}>{day.slice(8)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
