"use client";
import { useEffect, useState } from "react";

// Shared presentation helpers for the two competition boards (points + referrals).
export const fmtG = (wei: string) => Math.round(Number(wei) / 1e18).toLocaleString();
export const fmtScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const nameOrShort = (u: string | null, root: string) => (u ? `@${u}` : shortAddr(root));
const pad = (n: number) => String(n).padStart(2, "0");

export type Phase = "upcoming" | "live" | "ended";

export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function HowStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-lime border-2 border-ink flex items-center justify-center font-black text-xs">{n}</span>
      <span className="text-sm text-ink leading-snug">{children}</span>
    </li>
  );
}

function CountBox({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="bg-ink text-lime border-2 border-ink rounded-xl w-14 py-2 text-center font-black text-2xl tabular-nums shadow-brutal-sm">{pad(value)}</div>
      <span className="text-[10px] font-black uppercase tracking-wider text-muted mt-1">{unit}</span>
    </div>
  );
}

// Countdown to start (before it opens) or to the finish line (while live).
export function Countdown({ phase, target, now }: { phase: Phase; target: number; now: number }) {
  const remaining = Math.max(0, target - now);
  const days = Math.floor(remaining / 86400), hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60), secs = remaining % 60;
  return (
    <div className="mt-4">
      <p className="text-[11px] font-black uppercase tracking-wider text-lime mb-2">
        {phase === "upcoming" ? "Starts in" : phase === "live" ? "Ends in" : "Competition ended"}
      </p>
      {phase !== "ended" ? (
        <div className="flex items-end justify-center gap-2.5">
          <CountBox value={days} unit="days" /><CountBox value={hours} unit="hrs" />
          <CountBox value={mins} unit="min" /><CountBox value={secs} unit="sec" />
        </div>
      ) : (
        <p className="font-black text-lg text-lime">Final standings below</p>
      )}
    </div>
  );
}

export function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="bg-card border-2 border-ink rounded-2xl p-3 shadow-brutal-sm flex flex-col items-center text-center">
      <div className="text-ink mb-1">{icon}</div>
      <div className="font-black text-lg leading-none tabular-nums">{value}</div>
      <div className="text-[10px] font-black uppercase tracking-wide text-muted mt-1">{label}</div>
    </div>
  );
}

export const rankBg = (rank: number) =>
  rank === 1 ? "bg-[#FFD700] border-ink text-ink"
  : rank === 2 ? "bg-[#C0C0C0] border-ink text-ink"
  : rank === 3 ? "bg-[#CD7F32] border-ink text-white"
  : "bg-border text-muted";

// Your personal invite link + copy button — identical on both boards.
export function InviteLink({ myLink }: { myLink: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!myLink) return;
    navigator.clipboard?.writeText(myLink).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={myLink} className="flex-1 min-w-0 border-2 border-ink rounded-lg px-3 py-2 text-xs font-mono bg-cream outline-none" />
      <button onClick={copy} className="btn-brutal flex items-center gap-1.5 px-3 py-2 rounded-lg font-black text-sm bg-lime text-ink shrink-0">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// Shared polling: refresh every 60s while the contest is still relevant, and
// immediately when the tab regains focus.
export function usePoll(load: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [active, load]);
}
