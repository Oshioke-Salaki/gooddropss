"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { useDrops } from "@/hooks/useDrops";
import { formatG$ } from "@/lib/utils";
import { resolveRoots } from "@/lib/roots";
import { UserHandle } from "@/components/UserHandle";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { DROP_STATUS } from "@/types";
import { Flame, Trophy, Target } from "lucide-react";
import clsx from "clsx";

// ── Sprint window ───────────────────────────────────────────────────────────
// Times are WAT (UTC+1). Edit these two lines to reschedule the sprint.
const SPRINT_START = Math.floor(Date.parse("2026-08-17T06:00:00+01:00") / 1000); // Mon 6am WAT
const SPRINT_END   = Math.floor(Date.parse("2026-08-20T17:00:00+01:00") / 1000); // Thu 5pm WAT
const PRIZE_POOL   = "500,000";
const ZERO = "0x0000000000000000000000000000000000000000";

// Ranked purely by claims made INSIDE the window; the pool rewards activity.
interface Row { address: string; count: number; totalWei: bigint }

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

function CountdownBox({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="bg-ink text-lime border-2 border-ink rounded-xl w-14 py-2 text-center font-black text-2xl tabular-nums shadow-brutal-sm">
        {pad(value)}
      </div>
      <span className="text-[10px] font-black uppercase tracking-wider text-muted mt-1">{unit}</span>
    </div>
  );
}

export default function CampusSprintPage() {
  const { drops, loading, fetchDrops } = useDrops();
  const { address: me } = useAccount();
  const [roots, setRoots] = useState<Map<string, string>>(new Map());

  useEffect(() => { fetchDrops(); }, [fetchDrops]);

  const now = useNow();
  const phase: "upcoming" | "live" | "ended" =
    now < SPRINT_START ? "upcoming" : now < SPRINT_END ? "live" : "ended";

  // Live standings — poll every 30s, and keep polling for 5 minutes AFTER the
  // cutoff so the final board captures last-second claims once the subgraph
  // indexes them. Also refresh instantly whenever the hunter returns to the tab.
  // `pollActive` is a boolean so the interval isn't torn down every second.
  const pollActive = now < SPRINT_END + 5 * 60;
  useEffect(() => {
    if (!pollActive) return;
    const id = setInterval(() => { fetchDrops(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") fetchDrops(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [pollActive, fetchDrops]);
  const target = phase === "upcoming" ? SPRINT_START : SPRINT_END;
  const remaining = Math.max(0, target - now);
  const days  = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const mins  = Math.floor((remaining % 3600) / 60);
  const secs  = remaining % 60;

  // Resolve identity roots only for hunters who claimed inside the window, so a
  // person's linked wallets collapse into one entry (no multi-wallet farming).
  useEffect(() => {
    if (drops.length === 0) return;
    const addrs = new Set<string>();
    for (const d of drops) {
      if (d.status !== DROP_STATUS.Claimed || d.claimer === ZERO) continue;
      const t = d.claimedAt || 0;
      if (t >= SPRINT_START && t < SPRINT_END) addrs.add(d.claimer.toLowerCase());
    }
    if (addrs.size === 0) { setRoots(new Map()); return; }
    let cancelled = false;
    resolveRoots([...addrs]).then((m) => { if (!cancelled) setRoots(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [drops]);

  const keyOf = useMemo(
    () => (a: string) => roots.get(a.toLowerCase()) ?? a.toLowerCase(),
    [roots],
  );

  const rows = useMemo<Row[]>(() => {
    type Agg = { count: number; wei: bigint; displayAddr: string; latest: number };
    const map = new Map<string, Agg>();
    for (const d of drops) {
      if (d.status !== DROP_STATUS.Claimed || d.claimer === ZERO) continue;
      const t = d.claimedAt || 0;
      if (t < SPRINT_START || t >= SPRINT_END) continue;
      const key = keyOf(d.claimer);
      const wallet = d.claimer.toLowerCase();
      const prev = map.get(key);
      if (!prev) { map.set(key, { count: 1, wei: d.amount, displayAddr: wallet, latest: t }); continue; }
      const newer = t >= prev.latest;
      map.set(key, {
        count: prev.count + 1,
        wei: prev.wei + d.amount,
        displayAddr: newer ? wallet : prev.displayAddr,
        latest: newer ? t : prev.latest,
      });
    }
    return [...map.values()]
      .map((a) => ({ address: a.displayAddr, count: a.count, totalWei: a.wei }))
      // Most claims wins; ties broken by more G$ claimed.
      .sort((a, b) => b.count - a.count || (b.totalWei > a.totalWei ? 1 : -1));
  }, [drops, keyOf]);

  const totalClaims = rows.reduce((s, r) => s + r.count, 0);
  const myKey = me ? keyOf(me) : null;
  const myIdx = myKey ? rows.findIndex((r) => keyOf(r.address) === myKey) : -1;
  const myRow = myIdx >= 0 ? rows[myIdx] : null;

  return (
    <div className="min-h-screen bg-cream pb-24">
      <Nav />

      <div className="max-w-screen-md mx-auto px-4 pt-20 pb-8">

        {/* Hero */}
        <div className="bg-ink text-cream border-2 border-ink rounded-2xl p-5 shadow-brutal mb-5 text-center">
          <div className="inline-flex items-center gap-1.5 bg-lime text-ink font-black text-xs px-3 py-1 rounded-full mb-3">
            <Flame size={13} /> CAMPUS SPRINT
          </div>
          <p className="font-black text-4xl leading-none">
            {PRIZE_POOL} <span className="text-lime">G$</span>
          </p>
          <p className="text-sm text-cream/70 mt-2 leading-relaxed">
            Claim the most drops before the clock runs out to win a share of the pool.
            Most claims wins — ties broken by total G$.
          </p>

          {/* Countdown */}
          <div className="mt-4">
            <p className="text-[11px] font-black uppercase tracking-wider text-lime mb-2">
              {phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "Sprint ended"}
            </p>
            {phase !== "ended" ? (
              <div className="flex items-end justify-center gap-2.5">
                <CountdownBox value={days} unit="days" />
                <CountdownBox value={hours} unit="hrs" />
                <CountdownBox value={mins} unit="min" />
                <CountdownBox value={secs} unit="sec" />
              </div>
            ) : (
              <p className="font-black text-lg text-lime">Final standings below 🏁</p>
            )}
          </div>
        </div>

        {/* Live/phase note */}
        {phase === "live" && (
          <div className="flex items-center justify-center gap-2 text-sm font-bold text-ink mb-4">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live now — every claim counts
          </div>
        )}
        {phase === "upcoming" && (
          <p className="text-center text-sm text-muted mb-4">The board goes live the moment the sprint starts. Get ready.</p>
        )}

        {/* Sprint stats */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          <div className="bg-lime border-2 border-ink rounded-2xl p-3 text-center shadow-brutal-sm">
            <div className="text-2xl font-black">{totalClaims}</div>
            <div className="text-xs font-bold mt-0.5">Claims this sprint</div>
          </div>
          <div className="bg-card border-2 border-ink rounded-2xl p-3 text-center shadow-brutal-sm">
            <div className="text-2xl font-black">{rows.length}</div>
            <div className="text-xs text-muted font-semibold mt-0.5">Hunters competing</div>
          </div>
        </div>

        {/* Your position */}
        {me && (
          <div className={clsx(
            "border-2 border-ink rounded-2xl px-4 py-3 mb-5 flex items-center gap-3",
            myRow ? "bg-lime shadow-brutal" : "bg-card",
          )}>
            <Target size={20} className="shrink-0" />
            {myRow ? (
              <p className="font-bold text-sm">
                You&apos;re <span className="font-black">#{myIdx + 1}</span> with{" "}
                <span className="font-black">{myRow.count}</span> claim{myRow.count === 1 ? "" : "s"} — keep hunting!
              </p>
            ) : (
              <p className="font-bold text-sm">
                You&apos;re not on the board yet. {phase === "live" ? "Claim a drop to get in!" : "Claims during the sprint will count here."}
              </p>
            )}
          </div>
        )}

        {/* Leaderboard */}
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={18} />
          <p className="font-black text-lg">Sprint Leaderboard</p>
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 bg-border rounded-2xl animate-pulse" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-14 space-y-2">
            <Flame size={40} className="mx-auto text-muted" strokeWidth={1.5} />
            <p className="font-bold">No claims yet</p>
            <p className="text-sm text-muted">
              {phase === "live" ? "Be the first to claim a drop this sprint!" : "The race hasn't started. Check back soon."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => {
              const rank = i + 1;
              const isMe = !!myKey && keyOf(r.address) === myKey;
              const top3 = rank <= 3;
              const rankBg = rank === 1 ? "bg-[#FFD700] border-ink text-ink"
                : rank === 2 ? "bg-[#C0C0C0] border-ink text-ink"
                : rank === 3 ? "bg-[#CD7F32] border-ink text-white"
                : "bg-border text-muted";
              return (
                <div
                  key={r.address}
                  className={clsx(
                    "border-2 border-ink rounded-2xl px-3 py-3 flex items-center gap-3 min-w-0",
                    isMe ? "bg-lime shadow-brutal" : top3 ? "bg-card shadow-brutal-sm" : "bg-card",
                  )}
                >
                  <div className={clsx("w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-black shrink-0", rankBg)}>
                    {rank}
                  </div>
                  <ProfileAvatar address={r.address} size={34} ringColor={top3 ? "#111" : "#d6d5cf"} />
                  <Link href={`/hunter/${r.address}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                    <div className="font-bold text-sm truncate">
                      <UserHandle address={r.address} />
                    </div>
                    <div className="text-xs opacity-70 font-medium">{formatG$(r.totalWei)} G$ claimed</div>
                  </Link>
                  <div className="text-right shrink-0">
                    <div className="font-black text-xl leading-none tabular-nums">{r.count}</div>
                    <div className="text-[11px] opacity-70 font-semibold uppercase tracking-wide">claims</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
