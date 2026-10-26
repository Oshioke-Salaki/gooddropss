"use client";
import { useEffect, useState, useCallback } from "react";
import type { Spot, SpotStatus } from "@/types";
import { spotStatus, SPOT_STATUS_META } from "@/lib/spotStatus";
import { shortAddr } from "@/lib/utils";
import {
  Store, MapPin, Check, X, Ban, Trash2, Play, Clock, Pause,
  XCircle, CircleCheck, Plus, type LucideIcon,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import {
  AdminPage, Button, Card, EmptyState, Field, Hint, Input, RowsSkeleton, Select, Tag,
} from "@/components/admin/ui";

const STATUS_ICON: Record<SpotStatus, LucideIcon> = {
  active: CircleCheck, pending: Clock, paused: Pause, suspended: Ban, rejected: XCircle,
};

const CATEGORIES = ["food", "retail", "services", "transport", "other"];
const ORDER: SpotStatus[] = ["pending", "active", "paused", "suspended", "rejected"];

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

  const byStatus = spots
    ? ORDER.map((s) => ({ status: s, items: spots.filter((sp) => spotStatus(sp) === s) })).filter((g) => g.items.length > 0)
    : [];
  const pendingCount = spots?.filter((s) => spotStatus(s) === "pending").length ?? 0;

  return (
    <AdminPage
      title="Businesses"
      subtitle={
        spots === null
          ? "Loading…"
          : `${pendingCount > 0 ? `${pendingCount} awaiting approval` : "All caught up"} · ${spots.length} total`
      }
      actions={
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" strokeWidth={2} /> Create
        </Button>
      }
    >
      <Hint text={err} tone="bad" className="mb-3" />

      {spots === null ? (
        <RowsSkeleton count={4} height="h-32" />
      ) : spots.length === 0 ? (
        <Card><EmptyState icon={Store} title="No businesses yet" body="Registered spots will show up here for approval." /></Card>
      ) : (
        byStatus.map(({ status, items }) => {
          const meta = SPOT_STATUS_META[status];
          const GroupIcon = STATUS_ICON[status];
          return (
            <section key={status} className="mb-8">
              <p className="flex items-center gap-2 text-sm/none text-nav-muted mb-3 px-1">
                <GroupIcon className="w-4 h-4" strokeWidth={2} /> {meta.label} · {items.length}
              </p>
              <div className="flex flex-col gap-3">
                {items.map((s) => (
                  <Card key={s.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="w-11.5 h-11.5 rounded-full bg-surface flex items-center justify-center text-heading shrink-0">
                          <Store className="w-5 h-5" strokeWidth={1.75} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-lg/none text-heading truncate">{s.name}</p>
                          <p className="flex items-center gap-1 text-sm/none text-nav-muted mt-2 truncate">
                            {s.category} · owner {shortAddr(s.ownerAddress)} · <MapPin className="w-3.5 h-3.5 inline shrink-0" strokeWidth={2} />
                            {s.placeName || `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}
                          </p>
                          {s.description && <p className="text-sm/[140%] text-nav-muted mt-2">{s.description}</p>}
                          {s.note && <p className="text-sm/[140%] text-danger mt-2">Note: {s.note}</p>}
                        </div>
                      </div>
                      <Tag tone={meta.tone} className="shrink-0">{meta.label}</Tag>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-4">
                      {status === "pending" && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => act(s.id, "approve")} busy={busy === s.id + "approve"}>
                            <Check className="w-4 h-4" strokeWidth={2} /> Approve
                          </Button>
                          <Button size="sm" onClick={() => act(s.id, "reject", promptNote())} busy={busy === s.id + "reject"}>
                            <X className="w-4 h-4" strokeWidth={2} /> Reject
                          </Button>
                        </>
                      )}
                      {status === "active" && (
                        <Button size="sm" onClick={() => act(s.id, "suspend", promptNote())} busy={busy === s.id + "suspend"}>
                          <Ban className="w-4 h-4" strokeWidth={2} /> Suspend
                        </Button>
                      )}
                      {status === "paused" && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => act(s.id, "reactivate")} busy={busy === s.id + "reactivate"}>
                            <Play className="w-4 h-4" strokeWidth={2} /> Reactivate
                          </Button>
                          <Button size="sm" onClick={() => act(s.id, "suspend", promptNote())} busy={busy === s.id + "suspend"}>
                            <Ban className="w-4 h-4" strokeWidth={2} /> Suspend
                          </Button>
                        </>
                      )}
                      {status === "suspended" && (
                        <Button size="sm" variant="primary" onClick={() => act(s.id, "reactivate")} busy={busy === s.id + "reactivate"}>
                          <Play className="w-4 h-4" strokeWidth={2} /> Reactivate
                        </Button>
                      )}
                      {/* Delete — only for hidden (non-live) businesses, so a legit
                          active spot can't be wiped by a stray tap. */}
                      {status !== "active" && (
                        <Button size="sm" variant="danger" onClick={() => remove(s.id, s.name)} busy={busy === s.id + "delete"} className="ml-auto">
                          <Trash2 className="w-4 h-4" strokeWidth={2} /> Delete
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          );
        })
      )}

      {showCreate && (
        <CreateSheet onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
    </AdminPage>
  );
}

function promptNote(): string | undefined {
  const n = typeof window !== "undefined" ? window.prompt("Optional note (reason) — leave blank to skip:") : "";
  return n?.trim() || undefined;
}

function CreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: "", description: "", category: "food", discount: "", wallet: "", ownerAddress: "", lat: "", lng: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setErr(""); };

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

  return (
    <Sheet title="Create a business" onClose={onClose} dismissible={!busy} width={480}>
      <p className="text-sm/[140%] text-nav-muted mt-3">Goes live immediately, no approval step.</p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Business name"><Input placeholder="Mama Put Kitchen" value={f.name} onChange={set("name")} disabled={busy} /></Field>
        <Field label="Description"><Input placeholder="What they sell" value={f.description} onChange={set("description")} disabled={busy} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={f.category} onChange={set("category")} disabled={busy}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Offer"><Input placeholder="10% off" value={f.discount} onChange={set("discount")} disabled={busy} /></Field>
        </div>
        <Field label="Owner wallet"><Input placeholder="0x…" value={f.ownerAddress} onChange={set("ownerAddress")} disabled={busy} spellCheck={false} /></Field>
        <Field label="Payout wallet"><Input placeholder="0x…" value={f.wallet} onChange={set("wallet")} disabled={busy} spellCheck={false} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude"><Input placeholder="6.5244" value={f.lat} onChange={set("lat")} disabled={busy} inputMode="decimal" /></Field>
          <Field label="Longitude"><Input placeholder="3.3792" value={f.lng} onChange={set("lng")} disabled={busy} inputMode="decimal" /></Field>
        </div>
        <Hint text={err} tone="bad" className="px-1" />
        <Button type="submit" variant="primary" size="lg" busy={busy}>
          {busy ? "Creating…" : "Create live business"}
        </Button>
      </form>
    </Sheet>
  );
}
