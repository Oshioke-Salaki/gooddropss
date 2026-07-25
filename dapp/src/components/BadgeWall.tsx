"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { BadgeSetDef } from "@/lib/badges";
import { GOOD_DROPS_BADGES_ADDRESS } from "@/lib/contracts";

interface WallBadge {
  id: string; name: string; emoji: string; description: string;
  builtin: boolean; earned: boolean; earnedAt: number | null; holders: number; minted: boolean;
}

// The hunter's badge wall — earned badges up front with rarity ("held by N"),
// locked ones greyed with how to get them, and set/collection progress. Fetching
// this endpoint ALSO lazily awards anything newly eligible, so the wall is
// always current the moment it's looked at.
export function BadgeWall({ address }: { address: string }) {
  const { address: connected } = useAccount();
  const isOwn = !!connected && connected.toLowerCase() === address.toLowerCase();
  const [badges, setBadges] = useState<WallBadge[] | null>(null);
  const [sets, setSets] = useState<BadgeSetDef[]>([]);
  const [minting, setMinting] = useState<string | null>(null);
  const [mintErr, setMintErr] = useState("");

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

  async function mint(id: string) {
    if (!connected || minting) return;
    setMinting(id); setMintErr("");
    try {
      const res = await fetch("/api/badges/mint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: connected, badgeId: id }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && (d.ok || d.already)) {
        setBadges((bs) => bs?.map((b) => (b.id === id ? { ...b, minted: true } : b)) ?? bs);
      } else {
        setMintErr(d.error ?? (d.reason === "resting" ? "Minting is busy — try again shortly." : "Couldn't mint — try again."));
      }
    } catch { setMintErr("Network error — try again."); }
    finally { setMinting(null); }
  }

  if (badges === null) {
    return <p className="text-sm font-semibold text-muted animate-pulse">Loading badges…</p>;
  }
  if (badges.length === 0) return null;

  const earned = badges.filter((b) => b.earned);
  const locked = badges.filter((b) => !b.earned);
  const earnedIds = new Set(earned.map((b) => b.id));

  return (
    <div className="space-y-4">
      {/* Sets / collections first — they're the quests */}
      {sets.length > 0 && (
        <div className="space-y-2.5">
          {sets.map((s) => {
            const total = s.badgeIds.length;
            const got = s.badgeIds.filter((id) => earnedIds.has(id)).length;
            const done = got === total;
            return (
              <div key={s.id} className={`border-2 border-ink rounded-2xl p-3.5 shadow-brutal-sm ${done ? "bg-lime" : "bg-card"}`}>
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

      {/* Earned */}
      {earned.length > 0 && (
        <>
          {mintErr && <p className="text-xs font-bold text-danger">{mintErr}</p>}
          <div className="flex flex-wrap gap-2">
            {earned.map((b) => (
              <div key={b.id} title={b.description}
                className="flex items-center gap-2 bg-card border-2 border-ink rounded-full pl-2 pr-2.5 py-1.5 shadow-brutal-sm">
                <span className="text-base leading-none">{b.emoji}</span>
                <span className="text-xs font-bold">{b.name}</span>
                <span className="text-[10px] font-bold text-muted">· {b.holders}</span>
                {b.minted ? (
                  <a
                    href={`https://celoscan.io/token/${GOOD_DROPS_BADGES_ADDRESS}?a=${address.toLowerCase()}`}
                    target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                    title="View on Celoscan"
                    className="text-[10px] font-black text-lime bg-ink rounded-full px-1.5 py-0.5 leading-none">
                    ⛓ on-chain
                  </a>
                ) : isOwn ? (
                  <button
                    onClick={() => mint(b.id)} disabled={minting !== null}
                    className="text-[10px] font-black text-ink bg-lime border border-ink rounded-full px-1.5 py-0.5 leading-none disabled:opacity-60"
                  >
                    {minting === b.id ? "minting…" : "⛓ mint free"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Locked — show the path, greyed out */}
      {locked.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {locked.map((b) => (
            <div key={b.id} title={b.description}
              className="flex items-center gap-2 border-2 border-dashed border-ink/25 rounded-full pl-2 pr-3 py-1.5 opacity-55">
              <span className="text-base leading-none grayscale">{b.emoji}</span>
              <div className="leading-tight">
                <span className="block text-xs font-bold text-muted">{b.name}</span>
                <span className="block text-[10px] text-muted">{b.description}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
