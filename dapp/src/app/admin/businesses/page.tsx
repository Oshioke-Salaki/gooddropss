"use client";
import { useEffect, useState, useCallback } from "react";
import type { Spot, SpotStatus } from "@/types";
import { spotStatus, SPOT_STATUS_META } from "@/lib/spotStatus";
import { shortAddr } from "@/lib/utils";

const CATEGORIES = ["food", "retail", "services", "transport", "other"];
const ORDER: SpotStatus[] = ["pending", "active", "paused", "suspended", "rejected"];
const TONE: Record<string, string> = {
  good: "bg-lime border-ink text-ink", warn: "bg-[#FFF4E0] border-ink text-ink",
  bad: "bg-red-100 border-red-400 text-red-700", muted: "bg-gray-100 border-gray-400 text-gray-600",
};

export default function AdminBusinesses() {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    fetch("/api/spots?scope=all")
      .then((r) => r.json())
      .then((d) => {
        setSpots(Array.isArray(d.spots) ? d.spots : []);
        window.dispatchEvent(new CustomEvent("gd:businesses-updated"));
      })
      .catch(() => setSpots([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: string, note?: string) {
    if (busy) return;
    setBusy(id + action); setErr("");
    try {
      const res = await fetch(`/api/spots/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(note ? { note } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Action failed"); return; }
      load();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  async function remove(id: string, name: string) {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm(`Permanently delete "${name}"? This can't be undone.`)) return;
    setBusy(id + "delete"); setErr("");
    try {
      const res = await fetch(`/api/spots/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Delete failed"); return; }
      load();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  if (spots === null) return <p className="p-6 font-semibold text-gray-500 animate-pulse">Loading businesses…</p>;

  const byStatus = ORDER.map((s) => ({ status: s, items: spots.filter((sp) => spotStatus(sp) === s) })).filter((g) => g.items.length > 0);
  const pendingCount = spots.filter((s) => spotStatus(s) === "pending").length;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-black">Businesses 🏪</h1>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-brutal px-3 py-2 rounded-xl font-black text-sm bg-lime text-ink">
          {showCreate ? "Close" : "＋ Create"}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {pendingCount > 0 ? `${pendingCount} awaiting approval` : "All caught up"} · {spots.length} total
      </p>

      {err && <p className="text-sm font-bold text-red-600 mb-3">{err}</p>}

      {showCreate && <CreateForm onCreated={() => { setShowCreate(false); load(); }} />}

      {byStatus.map(({ status, items }) => {
        const meta = SPOT_STATUS_META[status];
        return (
          <div key={status} className="mb-6">
            <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">{meta.emoji} {meta.label} ({items.length})</p>
            <div className="space-y-2.5">
              {items.map((s) => (
                <div key={s.id} className="border-2 border-ink rounded-2xl p-3.5 bg-white shadow-brutal-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black">{s.name}</p>
                      <p className="text-xs text-gray-500">{s.category} · owner {shortAddr(s.ownerAddress)} · 📍 {s.lat.toFixed(4)}, {s.lng.toFixed(4)}</p>
                      {s.description && <p className="text-xs text-gray-600 mt-1">{s.description}</p>}
                      {s.note && <p className="text-xs text-red-600 mt-1">note: {s.note}</p>}
                    </div>
                    <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border-2 ${TONE[meta.tone]}`}>{meta.label}</span>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {status === "pending" && (
                      <>
                        <ActBtn onClick={() => act(s.id, "approve")} busy={busy === s.id + "approve"} primary>✓ Approve</ActBtn>
                        <ActBtn onClick={() => act(s.id, "reject", promptNote())} busy={busy === s.id + "reject"}>✕ Reject</ActBtn>
                      </>
                    )}
                    {status === "active" && (
                      <ActBtn onClick={() => act(s.id, "suspend", promptNote())} busy={busy === s.id + "suspend"}>🚫 Suspend</ActBtn>
                    )}
                    {status === "paused" && (
                      <>
                        <ActBtn onClick={() => act(s.id, "reactivate")} busy={busy === s.id + "reactivate"} primary>▶️ Reactivate</ActBtn>
                        <ActBtn onClick={() => act(s.id, "suspend", promptNote())} busy={busy === s.id + "suspend"}>🚫 Suspend</ActBtn>
                      </>
                    )}
                    {status === "suspended" && (
                      <ActBtn onClick={() => act(s.id, "reactivate")} busy={busy === s.id + "reactivate"} primary>▶️ Reactivate</ActBtn>
                    )}
                    {/* Delete — only for hidden (non-live) businesses, so a legit
                        active spot can't be wiped by a stray tap. */}
                    {status !== "active" && (
                      <ActBtn onClick={() => remove(s.id, s.name)} busy={busy === s.id + "delete"} danger>🗑️ Delete</ActBtn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {spots.length === 0 && <p className="text-gray-500 text-center py-10">No businesses registered yet.</p>}
    </div>
  );
}

function promptNote(): string | undefined {
  const n = typeof window !== "undefined" ? window.prompt("Optional note (reason) — leave blank to skip:") : "";
  return n?.trim() || undefined;
}

function ActBtn({ children, onClick, busy, primary, danger }: { children: React.ReactNode; onClick: () => void; busy: boolean; primary?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className={`btn-brutal px-3 py-1.5 rounded-lg font-black text-sm disabled:opacity-60 ${danger ? "bg-red-100 text-red-700 border-red-400" : primary ? "bg-lime text-ink" : "bg-white"}`}>
      {busy ? "…" : children}
    </button>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ name: "", description: "", category: "food", discount: "", wallet: "", ownerAddress: "", lat: "", lng: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setErr("");
    const lat = parseFloat(f.lat), lng = parseFloat(f.lng);
    if (f.name.trim().length < 2) return setErr("Name too short");
    if (!/^0x[0-9a-fA-F]{40}$/.test(f.wallet)) return setErr("Invalid payout wallet");
    if (!/^0x[0-9a-fA-F]{40}$/.test(f.ownerAddress)) return setErr("Invalid owner address");
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return setErr("Invalid coordinates");
    setBusy(true);
    try {
      const res = await fetch("/api/spots", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, lat, lng }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Failed"); return; }
      onCreated();
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  }

  const inp = "w-full border-2 border-ink rounded-lg px-3 py-2 text-sm outline-none mb-2";
  return (
    <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm mb-6">
      <p className="font-black text-sm mb-3">Create a business (goes live immediately)</p>
      <input className={inp} placeholder="Business name" value={f.name} onChange={set("name")} />
      <input className={inp} placeholder="Description" value={f.description} onChange={set("description")} />
      <div className="grid grid-cols-2 gap-2">
        <select className={inp} value={f.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input className={inp} placeholder="Offer (10% off)" value={f.discount} onChange={set("discount")} />
      </div>
      <input className={inp} placeholder="Owner wallet 0x…" value={f.ownerAddress} onChange={set("ownerAddress")} />
      <input className={inp} placeholder="Payout wallet 0x…" value={f.wallet} onChange={set("wallet")} />
      <div className="grid grid-cols-2 gap-2">
        <input className={inp} placeholder="Latitude" value={f.lat} onChange={set("lat")} />
        <input className={inp} placeholder="Longitude" value={f.lng} onChange={set("lng")} />
      </div>
      {err && <p className="text-xs font-bold text-red-600 mb-2">{err}</p>}
      <button onClick={submit} disabled={busy} className="btn-brutal w-full py-2.5 rounded-xl font-black text-sm bg-lime text-ink disabled:opacity-60">
        {busy ? "Creating…" : "Create live business"}
      </button>
    </div>
  );
}
