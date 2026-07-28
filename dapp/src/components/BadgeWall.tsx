"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import clsx from "clsx";
import type { BadgeSetDef } from "@/lib/badges";
import { GOOD_DROPS_BADGES_ADDRESS } from "@/lib/contracts";

interface WallBadge {
  id: string; name: string; emoji: string; description: string;
  builtin: boolean; earned: boolean; earnedAt: number | null; holders: number; minted: boolean;
}

// The hunter's badge wall. Earned badges render as a scalable tile grid; locked
// ones show the path to unlock them. Saving to the wallet ("minting") is
// deliberately framed for non-crypto users — one friendly, free action instead
// of per-badge "mint" jargon. Fetching this endpoint ALSO lazily awards anything
// newly eligible, so the wall is always current the moment it's looked at.
export function BadgeWall({ address }: { address: string }) {
  const { address: connected } = useAccount();
  const isOwn = !!connected && connected.toLowerCase() === address.toLowerCase();
  const [badges, setBadges] = useState<WallBadge[] | null>(null);
  const [sets, setSets] = useState<BadgeSetDef[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saveErr, setSaveErr] = useState("");

  function load() {
    fetch(`/api/badges?address=${address.toLowerCase()}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.badges)) setBadges(d.badges);
        if (Array.isArray(d.sets)) setSets(d.sets);
      })
      .catch(() => setBadges((b) => b ?? []));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [address]);

  // Save every not-yet-saved earned badge in one go — free, relayer-paid. No
  // wallet popups, no gas, no jargon: the user just taps "Save".
  async function saveAll(ids: string[]) {
    if (!connected || saving || ids.length === 0) return;
    setSaving(true); setSaveErr(""); setProgress({ done: 0, total: ids.length });
    let anyErr = "";
    for (const id of ids) {
      try {
        const res = await fetch("/api/badges/mint", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: connected, badgeId: id }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && (d.ok || d.already)) {
          setBadges((bs) => bs?.map((b) => (b.id === id ? { ...b, minted: true } : b)) ?? bs);
        } else {
          anyErr = d.error ?? (d.reason === "resting" ? "Busy right now — try again in a moment." : "Couldn't save one — try again.");
        }
      } catch { anyErr = "Network hiccup — try again."; }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setSaveErr(anyErr);
    setSaving(false); setProgress(null);
  }

  if (badges === null) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-2 border-ink/10 rounded-2xl h-28 bg-ink/[0.03] animate-pulse" />
        ))}
      </div>
    );
  }
  if (badges.length === 0) return null;

  const earned = badges.filter((b) => b.earned);
  const locked = badges.filter((b) => !b.earned);
  const earnedIds = new Set(earned.map((b) => b.id));
  const unsaved = earned.filter((b) => !b.minted);
  const savedCount = earned.length - unsaved.length;

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-black">
          {earned.length} earned
          {locked.length > 0 && <span className="text-muted font-bold"> · {locked.length} to unlock</span>}
        </p>
        {savedCount > 0 && (
          <p className="text-[11px] font-bold text-muted">{savedCount} saved to wallet</p>
        )}
      </div>

      {/* Collections / sets — the quests */}
      {sets.length > 0 && (
        <div className="space-y-2.5">
          {sets.map((s) => {
            const total = s.badgeIds.length;
            const got = s.badgeIds.filter((id) => earnedIds.has(id)).length;
            const done = got === total;
            return (
              <div key={s.id} className={clsx("border-2 border-ink rounded-2xl p-3.5 shadow-brutal-sm", done ? "bg-lime" : "bg-card")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-black text-sm">{s.emoji} {s.name}{done && " — complete!"}</p>
                  <span className="text-xs font-black tabular-nums">{got}/{total}</span>
                </div>
                {s.description && <p className="text-xs text-muted mt-0.5">{s.description}</p>}
                <div className="mt-2 h-2 rounded-full bg-ink/10 overflow-hidden">
                  <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${(got / total) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Save-to-wallet nudge — own profile, only when there's something to save.
          One free action; deliberately no "mint" / "on-chain" jargon. */}
      {isOwn && unsaved.length > 0 && (
        <div className="bg-ink text-cream rounded-2xl p-4 shadow-brutal">
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none mt-0.5">✨</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm text-cream">
                Save your {unsaved.length} badge{unsaved.length !== 1 ? "s" : ""} to your wallet
              </p>
              <p className="text-[11.5px] text-cream/70 mt-0.5 leading-snug">
                Badges are free collectibles that prove you were really there. Saving keeps them
                yours forever — we cover the fees.
              </p>
            </div>
          </div>
          {saveErr && <p className="text-[11px] font-bold text-danger mt-2">{saveErr}</p>}
          <button
            onClick={() => saveAll(unsaved.map((b) => b.id))}
            disabled={saving}
            className="mt-3 w-full py-2.5 rounded-xl bg-lime text-ink border-2 border-lime font-black text-sm disabled:opacity-70"
          >
            {saving
              ? `Saving… ${progress ? `${progress.done}/${progress.total}` : ""}`
              : `Save badge${unsaved.length !== 1 ? "s" : ""} — free`}
          </button>
        </div>
      )}

      {/* Earned — tile grid (scales cleanly as badges grow) */}
      {earned.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          {earned.map((b) => {
            const tile = (
              <>
                {/* Saved check — quiet corner marker, no jargon on the face */}
                {b.minted && (
                  <span
                    title="Saved permanently to your wallet"
                    className="absolute top-2 right-2 w-5 h-5 rounded-full bg-lime border-2 border-ink flex items-center justify-center text-[10px] font-black leading-none"
                  >
                    ✓
                  </span>
                )}
                <span className="text-4xl leading-none">{b.emoji}</span>
                <span className="text-xs font-black leading-tight mt-1.5">{b.name}</span>
                <span className="text-[10px] font-bold text-muted mt-0.5">held by {b.holders}</span>
                {b.minted && (
                  <span className="text-[9.5px] font-bold text-muted/80 mt-1 uppercase tracking-wide">
                    ✓ Saved · view ↗
                  </span>
                )}
              </>
            );
            const cls = "relative flex flex-col items-center text-center bg-card border-2 border-ink rounded-2xl p-3 pt-4 shadow-brutal-sm min-h-[112px] justify-center";
            return b.minted ? (
              <a
                key={b.id} title={b.description}
                href={`https://celoscan.io/token/${GOOD_DROPS_BADGES_ADDRESS}?a=${address.toLowerCase()}`}
                target="_blank" rel="noopener noreferrer"
                className={clsx(cls, "hover:-translate-y-0.5 transition-transform no-underline text-ink")}
              >
                {tile}
              </a>
            ) : (
              <div key={b.id} title={b.description} className={cls}>
                {tile}
              </div>
            );
          })}
        </div>
      )}

      {/* Locked — the path to unlock, greyed */}
      {locked.length > 0 && (
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted mb-2 mt-1">Keep going to unlock</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {locked.map((b) => (
              <div
                key={b.id} title={b.description}
                className="flex flex-col items-center text-center border-2 border-dashed border-ink/25 rounded-2xl p-3 pt-4 min-h-[112px] justify-center opacity-70"
              >
                <span className="text-4xl leading-none grayscale opacity-60">{b.emoji}</span>
                <span className="text-xs font-bold text-muted leading-tight mt-1.5">{b.name}</span>
                <span className="text-[10px] text-muted mt-0.5 leading-snug">{b.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
