"use client";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import clsx from "clsx";
import { formatG$, shortAddr } from "@/lib/utils";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { DROP_STATUS } from "@/types";
import { spotActionMessage } from "@/lib/spotAuth";
import { spotStatus, isSpotActive, merchantCanReactivate, SPOT_STATUS_META } from "@/lib/spotStatus";
import type { Spot, SpotPayment, SpotStatus } from "@/types";
import { TaskDropCreator } from "@/components/merchant/TaskDropCreator";

interface SpotStats { count: number; totalWei: string; payments: SpotPayment[] }
interface RewardRow { dropId: string; task: string; amount: bigint; status: number }

function RewardBadge({ status }: { status: number }) {
  const s = status === DROP_STATUS.Claimed
    ? { t: "✅ Claimed", c: "bg-lime border-ink text-ink" }
    : status === DROP_STATUS.Reclaimed
    ? { t: "↩︎ Expired", c: "bg-gray-100 border-gray-300 text-gray-500" }
    : { t: "🟢 Live", c: "bg-white border-ink text-ink" };
  return <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full border ${s.c} whitespace-nowrap`}>{s.t}</span>;
}
const CATEGORIES = ["food", "retail", "services", "transport", "other"];

const TONE: Record<string, string> = {
  good:  "bg-lime border-ink text-ink",
  warn:  "bg-[#FFF4E0] border-ink text-ink",
  bad:   "bg-danger/10 border-danger text-danger",
  muted: "bg-border border-ink text-muted",
};

export function MerchantSpotCard({ spot, onChanged }: { spot: Spot; onChanged: () => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [stats, setStats] = useState<SpotStats | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [editing, setEditing]   = useState(false);
  const [busy, setBusy]         = useState<string | null>(null);
  const [err, setErr]           = useState("");

  const [name, setName] = useState(spot.name);
  const [description, setDescription] = useState(spot.description);
  const [category, setCategory] = useState(spot.category);
  const [discount, setDiscount] = useState(spot.discount);
  const [wallet, setWallet]     = useState(spot.wallet);

  const status = spotStatus(spot);
  const meta = SPOT_STATUS_META[status];
  const active = isSpotActive(spot);
  const isOwner = !!address && address.toLowerCase() === spot.ownerAddress.toLowerCase();

  const [rewards, setRewards] = useState<RewardRow[]>([]);

  useEffect(() => {
    fetch(`/api/spots/${spot.id}/payments`).then((r) => r.json()).then(setStats).catch(() => {});
  }, [spot.id]);

  // Reward drops for this spot + their live claim status (one batched multicall).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetch(`/api/task/list?spotId=${spot.id}`).then((r) => r.json());
        const list: { dropId: string; task?: string }[] = Array.isArray(d.rewards) ? d.rewards : [];
        if (list.length === 0) { if (alive) setRewards([]); return; }
        const res = await publicClient.multicall({
          contracts: list.map((r) => ({
            address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(r.dropId)],
          })),
        });
        const rows: RewardRow[] = list.map((r, i) => {
          const dd = res[i]?.status === "success" ? (res[i].result as unknown as { amount: bigint; status: number }) : null;
          return { dropId: r.dropId, task: r.task ?? "Reward", amount: dd?.amount ?? 0n, status: Number(dd?.status ?? 0) };
        });
        if (alive) setRewards(rows);
      } catch { /* best-effort */ }
    })();
    return () => { alive = false; };
  }, [spot.id, showTask]);

  async function signAction(action: string): Promise<{ signature: string; timestamp: number } | null> {
    const timestamp = Date.now();
    try {
      const signature = await signMessageAsync({ message: spotActionMessage(action, spot.id, timestamp) });
      return { signature, timestamp };
    } catch { return null; }
  }

  async function changeStatus(action: "pause" | "reactivate") {
    if (busy) return;
    setBusy(action); setErr("");
    const signed = await signAction(action);
    if (!signed) { setBusy(null); setErr("Cancelled."); return; }
    try {
      const res = await fetch(`/api/spots/${spot.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...signed }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't update — try again."); return; }
      onChanged();
    } catch { setErr("Network error — try again."); }
    finally { setBusy(null); }
  }

  async function saveEdits() {
    if (busy) return;
    if (name.trim().length < 2) { setErr("Name must be at least 2 characters."); return; }
    setBusy("edit"); setErr("");
    const signed = await signAction("edit");
    if (!signed) { setBusy(null); setErr("Cancelled."); return; }
    try {
      const res = await fetch(`/api/spots/${spot.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, category, discount, wallet, ...signed }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't save — try again."); return; }
      setEditing(false); onChanged();
    } catch { setErr("Network error — try again."); }
    finally { setBusy(null); }
  }

  return (
    <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm space-y-3">
      {/* Header + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-lg leading-tight">{spot.name}</p>
          {spot.description && <p className="text-xs text-muted mt-0.5">{spot.description}</p>}
        </div>
        <span className={clsx("shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border-2 whitespace-nowrap", TONE[meta.tone])}>
          {meta.emoji} {meta.label}
        </span>
      </div>

      {/* Status guidance */}
      {status === "pending" && <p className="text-xs bg-[#FFF4E0] border border-ink/20 rounded-lg px-3 py-2">🕓 An admin will review this shortly. It goes live once approved.</p>}
      {status === "suspended" && <p className="text-xs bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-danger font-semibold">🚫 Suspended by an admin. Contact support to restore it.{spot.note ? ` — ${spot.note}` : ""}</p>}
      {status === "rejected" && <p className="text-xs bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-danger">This business wasn&apos;t approved.{spot.note ? ` — ${spot.note}` : ""}</p>}

      <div className="text-xs text-muted space-y-1">
        <div>📍 {spot.lat.toFixed(4)}°, {spot.lng.toFixed(4)}°</div>
        <div>💳 Payouts → {shortAddr(spot.wallet)}</div>
        {spot.discount && <div>🎁 {spot.discount}</div>}
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-ink text-lime rounded-xl p-3">
          <div className="text-2xl font-black">{stats?.count ?? "…"}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Payments received</div>
        </div>
        <div className="bg-lime border-2 border-ink rounded-xl p-3">
          <div className="text-2xl font-black text-ink">{stats ? formatG$(BigInt(stats.totalWei)) : "…"} <span className="text-sm">G$</span></div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink/60">Total earned</div>
        </div>
      </div>

      {stats && stats.payments.length > 0 && (
        <>
          <button onClick={() => setExpanded((v) => !v)} className="w-full py-2 rounded-xl text-xs font-bold border border-ink text-muted hover:bg-border transition-colors">
            {expanded ? "Hide" : "Show"} recent payments {expanded ? "▲" : "▼"}
          </button>
          {expanded && (
            <div className="space-y-1.5">
              {stats.payments.slice(0, 10).map((p) => (
                <a key={p.tx} href={`https://celoscan.io/tx/${p.tx}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between text-xs bg-cream border border-border rounded-lg px-3 py-2 hover:border-ink transition-colors" style={{ textDecoration: "none" }}>
                  <span className="font-bold text-ink">{formatG$(BigInt(p.amount))} G$</span>
                  <span className="text-muted">{shortAddr(p.payer)}</span>
                  <span className="text-muted">{new Date(p.ts * 1000).toLocaleDateString()}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {/* Reward activity */}
      {rewards.length > 0 && (
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted mb-1.5">
            🎁 Rewards · {rewards.filter((r) => r.status === DROP_STATUS.Claimed).length} claimed · {rewards.filter((r) => r.status === DROP_STATUS.Active).length} live
          </p>
          <div className="space-y-1.5">
            {rewards.slice(0, 8).map((r) => (
              <div key={r.dropId} className="flex items-center justify-between gap-2 bg-cream border border-border rounded-lg px-3 py-2">
                <span className="text-xs font-bold truncate">{r.task}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-black">{formatG$(r.amount)} G$</span>
                  <RewardBadge status={r.status} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-xs font-bold text-danger">{err}</p>}

      {/* Edit form */}
      {editing && isOwner && (
        <div className="border-2 border-ink rounded-xl p-3 space-y-2 bg-cream">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" className="w-full border-2 border-ink rounded-lg px-3 py-2 text-sm font-bold outline-none" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className="w-full border-2 border-ink rounded-lg px-3 py-2 text-sm outline-none" />
          <div className="grid grid-cols-2 gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="border-2 border-ink rounded-lg px-2 py-2 text-sm font-semibold bg-white outline-none">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Offer (e.g. 10% off)" className="border-2 border-ink rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="Payout wallet 0x…" className="w-full border-2 border-ink rounded-lg px-3 py-2 text-xs font-mono outline-none" />
          <div className="flex gap-2">
            <button onClick={saveEdits} disabled={busy === "edit"} className="btn-brutal flex-1 py-2 rounded-lg font-black text-sm bg-lime text-ink disabled:opacity-60">{busy === "edit" ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setErr(""); }} className="btn-brutal px-4 py-2 rounded-lg font-bold text-sm bg-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Owner actions */}
      {isOwner && !editing && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEditing(true)} className="btn-brutal px-3 py-2 rounded-xl font-bold text-sm bg-white">✏️ Edit</button>
          {active && (
            <button onClick={() => changeStatus("pause")} disabled={busy === "pause"} className="btn-brutal px-3 py-2 rounded-xl font-bold text-sm bg-white disabled:opacity-60">
              {busy === "pause" ? "…" : "⏸️ Deactivate"}
            </button>
          )}
          {merchantCanReactivate(spot) && (
            <button onClick={() => changeStatus("reactivate")} disabled={busy === "reactivate"} className="btn-brutal px-3 py-2 rounded-xl font-black text-sm bg-lime text-ink disabled:opacity-60">
              {busy === "reactivate" ? "…" : "▶️ Reactivate"}
            </button>
          )}
        </div>
      )}

      {/* Reward drops — only when live */}
      {active && (
        showTask ? (
          <TaskDropCreator spot={spot} onClose={() => setShowTask(false)} onCreated={() => setShowTask(false)} />
        ) : (
          <button onClick={() => setShowTask(true)} className="btn-brutal w-full py-2.5 rounded-xl font-black text-sm bg-ink text-lime">🎁 Create a reward drop</button>
        )
      )}
    </div>
  );
}
