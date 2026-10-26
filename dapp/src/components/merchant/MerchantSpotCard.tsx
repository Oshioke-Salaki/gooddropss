"use client";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  MapPin, Wallet, Gift, Pencil, Eye, Megaphone, Pause, Play, Check, Store,
  Clock, Ban, XCircle, CheckCircle2, RotateCcw, ChevronDown, ChevronRight, Loader2,
  UtensilsCrossed, ShoppingBag, Wrench, Bus, ExternalLink, type LucideIcon,
} from "lucide-react";
import { formatG$, shortAddr } from "@/lib/utils";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { DROP_STATUS } from "@/types";
import { spotActionMessage } from "@/lib/spotAuth";
import { spotStatus, isSpotActive, merchantCanReactivate, SPOT_STATUS_META } from "@/lib/spotStatus";
import type { Spot, SpotPayment, SpotStatus } from "@/types";
import { TaskDropCreator } from "@/components/merchant/TaskDropCreator";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { ShopSheet } from "@/components/ShopSheet";
import { useLandmarks } from "@/hooks/useLandmarks";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";

interface SpotStats { count: number; totalWei: string; payments: SpotPayment[] }
interface RewardRow { dropId: string; task: string; amount: bigint; status: number }

// Lifecycle icon for the spot status badge (no emoji — they render poorly on Android).
const STATUS_ICON: Record<SpotStatus, LucideIcon> = {
  active: CheckCircle2, pending: Clock, paused: Pause, suspended: Ban, rejected: XCircle,
};

const CATEGORY_ICON: Record<string, LucideIcon> = {
  food: UtensilsCrossed, retail: ShoppingBag, services: Wrench, transport: Bus, other: Store,
};

const CATEGORIES: { id: string; label: string }[] = [
  { id: "food", label: "Food & Drink" },
  { id: "retail", label: "Retail" },
  { id: "services", label: "Services" },
  { id: "transport", label: "Transport" },
  { id: "other", label: "Other" },
];

const TONE: Record<string, string> = {
  good:  "bg-brand-soft text-brand",
  warn:  "bg-streak-bg text-streak",
  bad:   "bg-[#FFF0F0] text-danger",
  muted: "bg-surface text-nav-muted",
};

const INPUT =
  "w-full h-12 rounded-full bg-surface px-5 text-sm/none text-heading placeholder:text-nav-muted " +
  "border border-transparent outline-none motion-safe:transition-colors focus:border-brand disabled:opacity-60";

const PILL =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-line bg-white text-sm/none text-heading " +
  "cursor-pointer motion-safe:transition-colors hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

function RewardBadge({ status }: { status: number }) {
  const s = status === DROP_STATUS.Claimed
    ? { Icon: CheckCircle2, t: "Claimed", c: "bg-brand-soft text-brand" }
    : status === DROP_STATUS.Reclaimed
    ? { Icon: RotateCcw, t: "Expired", c: "bg-surface text-nav-muted" }
    : { Icon: CheckCircle2, t: "Live", c: "bg-surface text-heading" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs/none px-2.5 py-1.5 rounded-full whitespace-nowrap ${s.c}`}>
      <s.Icon className="w-3.5 h-3.5" strokeWidth={2} /> {s.t}
    </span>
  );
}

export function MerchantSpotCard({ spot, onChanged }: { spot: Spot; onChanged: () => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { landmarks } = useLandmarks();

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

  // Re-pin location (edit form) + customer preview.
  const [showPicker, setShowPicker] = useState(false);
  const [editCoords, setEditCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [editPlaceName, setEditPlaceName] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const status = spotStatus(spot);
  const meta = SPOT_STATUS_META[status];
  const StatusIcon = STATUS_ICON[status];
  const CategoryIcon = CATEGORY_ICON[spot.category] ?? Store;
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
        body: JSON.stringify({
          name, description, category, discount, wallet,
          ...(editCoords ? { lat: editCoords.lat, lng: editCoords.lng, placeName: editPlaceName ?? spot.placeName ?? "" } : {}),
          ...signed,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't save — try again."); return; }
      setEditing(false); setEditCoords(null); setEditPlaceName(null); onChanged();
    } catch { setErr("Network error — try again."); }
    finally { setBusy(null); }
  }

  const cancelEdit = () => { setEditing(false); setErr(""); setEditCoords(null); setEditPlaceName(null); };

  return (
    <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col gap-y-5 min-w-0">
      {/* ── Header + status ──────────────────────────────────────────────── */}
      {/* The status chip sits beside the name where there's room, and drops
          under it on phones so a long label never squeezes the shop name. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
            <CategoryIcon className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex flex-col gap-y-2">
            <p className="text-lg/none text-heading truncate">{spot.name}</p>
            {spot.description && <p className="text-sm/[140%] text-nav-muted line-clamp-2">{spot.description}</p>}
            <span className={`sm:hidden self-start inline-flex items-center gap-1.5 text-xs/none px-3 py-2 rounded-full whitespace-nowrap ${TONE[meta.tone]}`}>
              <StatusIcon className="w-3.5 h-3.5" strokeWidth={2} /> {meta.label}
            </span>
          </div>
        </div>
        <span className={`hidden sm:inline-flex shrink-0 items-center gap-1.5 text-xs/none px-3 py-2 rounded-full whitespace-nowrap ${TONE[meta.tone]}`}>
          <StatusIcon className="w-3.5 h-3.5" strokeWidth={2} /> {meta.label}
        </span>
      </div>

      {/* Status guidance */}
      {status === "pending" && (
        <p className="flex items-start gap-3 rounded-2xl bg-streak-bg px-4 py-3 text-sm/[140%] text-streak">
          <Clock className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={1.75} />
          <span>An admin will review this shortly. It goes live once approved.</span>
        </p>
      )}
      {status === "suspended" && (
        <p className="flex items-start gap-3 rounded-2xl bg-[#FFF0F0] px-4 py-3 text-sm/[140%] text-danger">
          <Ban className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={1.75} />
          <span>Suspended by an admin. Contact support to restore it.{spot.note ? ` — ${spot.note}` : ""}</span>
        </p>
      )}
      {status === "rejected" && (
        <p className="flex items-start gap-3 rounded-2xl bg-[#FFF0F0] px-4 py-3 text-sm/[140%] text-danger">
          <XCircle className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={1.75} />
          <span>This business wasn&apos;t approved.{spot.note ? ` — ${spot.note}` : ""}</span>
        </p>
      )}

      {/* Details */}
      <div className="flex flex-col gap-y-3 text-sm/none text-nav-muted">
        <p className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 shrink-0" strokeWidth={2} />
          <span className="truncate">{spot.placeName || `${spot.lat.toFixed(4)}°, ${spot.lng.toFixed(4)}°`}</span>
        </p>
        <p className="flex items-center gap-2 min-w-0">
          <Wallet className="w-4 h-4 shrink-0" strokeWidth={2} />
          <span className="truncate">Payouts to {shortAddr(spot.wallet)}</span>
        </p>
        {spot.discount && (
          <p className="flex items-center gap-2 min-w-0">
            <Gift className="w-4 h-4 shrink-0" strokeWidth={2} />
            <span className="truncate">{spot.discount}</span>
          </p>
        )}
      </div>

      {/* Onboarding checklist — guide a brand-new shop to its first payment
          instead of greeting them with a discouraging 0/0. */}
      {isOwner && (stats?.count ?? 0) === 0 && (
        <div className="rounded-2xl border border-line p-4 flex flex-col gap-y-3">
          <p className="text-base/none text-heading">Get your first payment</p>
          <Step done>Shop registered</Step>
          <Step done={active}>{active ? "Approved and live on the map" : "Awaiting admin approval"}</Step>
          <Step done={false}>Share your shop so customers can pay</Step>
          <Step done={false}>First G$ payment received</Step>
          {active && (
            <a
              href={`/shop/${spot.id}/poster`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-nav-active text-white text-sm/none
                cursor-pointer motion-safe:transition-opacity hover:opacity-90"
            >
              <Megaphone className="w-4 h-4" strokeWidth={1.75} /> Get your pay-here poster
            </a>
          )}
        </div>
      )}

      {/* ── Analytics ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface p-4 flex flex-col gap-y-2 min-w-0">
          {stats ? (
            <span className="text-2xl/none text-heading">{stats.count}</span>
          ) : (
            <Skeleton className="h-6 w-10 bg-white" />
          )}
          <span className="text-sm/[140%] text-nav-muted">Payments received</span>
        </div>
        <div className="rounded-2xl bg-surface p-4 flex flex-col gap-y-2 min-w-0">
          {stats ? (
            <span className="text-2xl/none text-heading truncate">
              {formatG$(BigInt(stats.totalWei))} <span className="text-sm/none text-nav-muted">G$</span>
            </span>
          ) : (
            <Skeleton className="h-6 w-16 bg-white" />
          )}
          <span className="text-sm/[140%] text-nav-muted">Total earned</span>
        </div>
      </div>

      {stats && stats.payments.length > 0 && (
        <div className="flex flex-col gap-y-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="self-start inline-flex items-center gap-2 h-10 px-4 rounded-full bg-surface text-sm/none text-heading
              cursor-pointer motion-safe:transition-colors hover:bg-nav-controls"
          >
            {expanded ? "Hide" : "Show"} recent payments
            <ChevronDown className={`w-4 h-4 motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} />
          </button>
          {expanded && (
            <div className="flex flex-col gap-y-2">
              {stats.payments.slice(0, 10).map((p) => (
                <a
                  key={p.tx}
                  href={`https://celoscan.io/tx/${p.tx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 border border-line rounded-full p-2 pr-5 min-w-0
                    motion-safe:transition-colors hover:bg-surface"
                >
                  <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading group-hover:bg-white">
                    <Wallet className="w-5 h-5" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-y-1">
                    <span className="text-base/none text-heading truncate">{formatG$(BigInt(p.amount))} G$</span>
                    <span className="text-sm/none text-nav-muted truncate">from {shortAddr(p.payer)}</span>
                  </span>
                  <span className="shrink-0 flex items-center gap-2 text-sm/none text-nav-muted">
                    {new Date(p.ts * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })}
                    <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reward activity ──────────────────────────────────────────────── */}
      {rewards.length > 0 && (
        <div className="flex flex-col gap-y-3">
          <p className="text-sm/none text-nav-muted">
            Rewards · {rewards.filter((r) => r.status === DROP_STATUS.Claimed).length} claimed
            · {rewards.filter((r) => r.status === DROP_STATUS.Active).length} live
          </p>
          <div className="flex flex-col gap-y-2">
            {rewards.slice(0, 8).map((r) => (
              <div key={r.dropId} className="flex items-center gap-3 border border-line rounded-full p-2 pr-3 min-w-0">
                <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
                  <Gift className="w-5 h-5" strokeWidth={1.75} />
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-y-1">
                  <span className="text-base/none text-heading truncate">{r.task}</span>
                  <span className="text-sm/none text-nav-muted">{formatG$(r.amount)} G$</span>
                </span>
                <RewardBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {err && (
        <p role="alert" className="text-sm/[140%] text-danger">{err}</p>
      )}

      {/* ── Edit form ────────────────────────────────────────────────────── */}
      {editing && isOwner && (
        <form
          className="rounded-2xl border border-line p-4 flex flex-col gap-y-3"
          onSubmit={(e) => { e.preventDefault(); saveEdits(); }}
        >
          <label className="block">
            <span className="sr-only">Business name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" maxLength={60} disabled={busy === "edit"} className={INPUT} />
          </label>
          <label className="block">
            <span className="sr-only">Short description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" maxLength={280} disabled={busy === "edit"} className={INPUT} />
          </label>
          <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy === "edit"}
                  onClick={() => setCategory(c.id)}
                  className={`h-10 px-4 rounded-full text-sm/none cursor-pointer motion-safe:transition-colors
                    ${on ? "bg-brand text-white" : "bg-surface text-heading hover:bg-nav-controls"}`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <label className="block">
            <span className="sr-only">Offer</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Offer (e.g. 10% off with G$)" maxLength={80} disabled={busy === "edit"} className={INPUT} />
          </label>
          <label className="block">
            <span className="sr-only">Payout wallet</span>
            <input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="Payout wallet 0x…" spellCheck={false} disabled={busy === "edit"} className={`${INPUT} font-mono placeholder:font-sans`} />
          </label>

          {/* Re-pin location */}
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            disabled={busy === "edit"}
            className="w-full h-12 rounded-full border border-line bg-white px-5 flex items-center justify-between gap-3 text-sm/none text-heading
              cursor-pointer motion-safe:transition-colors hover:bg-surface disabled:opacity-60"
          >
            <span className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 shrink-0" strokeWidth={2} />
              <span className="truncate">
                {editCoords
                  ? (editPlaceName || `${editCoords.lat.toFixed(5)}, ${editCoords.lng.toFixed(5)}`)
                  : (spot.placeName || `${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`)}
              </span>
            </span>
            <span className="shrink-0 flex items-center gap-1 text-nav-muted">
              Change <ChevronRight className="w-4 h-4" strokeWidth={2} />
            </span>
          </button>
          <p className={`h-4 px-5 text-sm/none ${editCoords ? "text-brand" : "text-nav-muted"}`}>
            {editCoords ? "New location set — save to apply." : ""}
          </p>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy === "edit"}
              className="flex-1 h-12 rounded-full bg-brand text-white text-sm/none cursor-pointer flex items-center justify-center gap-2
                motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed"
            >
              {busy === "edit" && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy === "edit" ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={cancelEdit} disabled={busy === "edit"} className={`${PILL} h-12`}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── Owner actions ────────────────────────────────────────────────── */}
      {isOwner && !editing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing(true)} className={PILL}>
            <Pencil className="w-4 h-4" strokeWidth={1.75} /> Edit
          </button>
          <button type="button" onClick={() => setShowPreview(true)} className={PILL}>
            <Eye className="w-4 h-4" strokeWidth={1.75} /> Preview
          </button>
          <a href={`/shop/${spot.id}/poster`} target="_blank" rel="noopener noreferrer" className={PILL}>
            <Megaphone className="w-4 h-4" strokeWidth={1.75} /> Poster
          </a>
          {active && (
            <button type="button" onClick={() => changeStatus("pause")} disabled={busy === "pause"} className={PILL}>
              {busy === "pause" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" strokeWidth={1.75} />}
              {busy === "pause" ? "Pausing…" : "Deactivate"}
            </button>
          )}
          {merchantCanReactivate(spot) && (
            <button
              type="button"
              onClick={() => changeStatus("reactivate")}
              disabled={busy === "reactivate"}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-brand text-white text-sm/none
                cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed"
            >
              {busy === "reactivate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" strokeWidth={1.75} />}
              {busy === "reactivate" ? "Reactivating…" : "Reactivate"}
            </button>
          )}
        </div>
      )}

      {/* Reward drops — only when live */}
      {active && (
        <button
          type="button"
          onClick={() => setShowTask(true)}
          className="w-full h-12 rounded-full bg-nav-active text-white text-sm/none flex items-center justify-center gap-2
            cursor-pointer motion-safe:transition-opacity hover:opacity-90"
        >
          <Gift className="w-4.5 h-4.5" strokeWidth={1.75} /> Create a reward drop
        </button>
      )}
      {showTask && (
        <TaskDropCreator spot={spot} onClose={() => setShowTask(false)} onCreated={onChanged} />
      )}

      {/* Re-pin map picker — mounted only while open (each holds a live map). */}
      {showPicker && (
        <LocationPickerSheet
          open
          initialCenter={editCoords ?? { lat: spot.lat, lng: spot.lng }}
          currentLocation={editCoords ?? { lat: spot.lat, lng: spot.lng }}
          pinIcon={<Store size={20} />}
          landmarks={landmarks}
          confirmLabel="Update shop location"
          onConfirm={(lat, lng, place) => { setEditCoords({ lat, lng }); setEditPlaceName(place); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Customer preview — how the shop looks in the pay sheet (pay disabled). */}
      <ShopSheet spot={showPreview ? spot : null} userLocation={null} preview onClose={() => setShowPreview(false)} />
    </section>
  );
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm/none">
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
          done ? "bg-brand text-white" : "border border-line bg-white"
        }`}
      >
        {done && <Check className="w-3 h-3" strokeWidth={3} />}
      </span>
      <span className={done ? "text-heading" : "text-nav-muted"}>{children}</span>
    </div>
  );
}
