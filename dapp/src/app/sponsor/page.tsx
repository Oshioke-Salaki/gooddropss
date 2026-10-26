"use client";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import {
  Loader2, Plus, ArrowLeft, ChevronRight, MapPin, Users, BarChart3,
  HeartHandshake, Flag, Sparkles, Check,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Nav } from "@/components/Nav";
import { CampaignDisc } from "@/components/CampaignDisc";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { dropTier } from "@/components/map/markers";

const BatchDropCreator = dynamic(
  () => import("@/components/BatchDropCreator").then((m) => ({ default: m.BatchDropCreator })),
  { ssr: false }
);
import { formatG$, parseDropHint } from "@/lib/utils";

// formatG$ renders 0n as "0.0000" (it assumes a sub-G$ value); a zero stat reads better bare.
const gLabel = (wei: bigint) => (wei === 0n ? "0 G$" : `${formatG$(wei)} G$`);
import { fetchAllDrops } from "@/lib/subgraph";
import { DROP_STATUS, type Campaign, type Drop } from "@/types";

// Stored on the campaign and painted on its pins, so the values are data —
// only the labels are presentation.
const ACCENT_COLORS = [
  { label: "Lime",   value: "#BFFD00" },
  { label: "Orange", value: "#FF6400" },
  { label: "Sky",    value: "#00CFFF" },
  { label: "Gold",   value: "#FFD700" },
  { label: "Coral",  value: "#FF3B6B" },
];

const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A]";
const PRIMARY =
  "h-12 px-5 rounded-full bg-brand text-white text-sm/none flex items-center justify-center gap-2 cursor-pointer " +
  "motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed whitespace-nowrap";
const SECONDARY =
  "h-11 px-5 rounded-full border border-line bg-white text-sm/none text-heading flex items-center justify-center gap-2 " +
  "cursor-pointer motion-safe:transition-colors hover:bg-surface whitespace-nowrap";
const FIELD =
  "w-full h-14 rounded-full bg-surface px-5 text-base/none text-heading placeholder:text-nav-muted " +
  "border border-transparent outline-none focus:border-brand motion-safe:transition-colors disabled:opacity-60";

// ── Small pieces ──────────────────────────────────────────────────────────────

function Chip({ value, label, loading }: { value: string; label: string; loading?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2.5 text-sm/none">
      {loading ? <Skeleton className="h-4 w-8" /> : <span className="text-heading">{value}</span>}
      <span className="whitespace-nowrap text-nav-muted">{label}</span>
    </div>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-sm/none text-nav-muted">{children}</span>
      {hint && <span className="text-sm/none text-nav-active">{hint}</span>}
    </div>
  );
}

// ── Campaign card ─────────────────────────────────────────────────────────────

function CampaignCard({ campaign, drops, claims, onSelect }: {
  campaign: Campaign; drops: Drop[]; claims: number; onSelect: () => void;
}) {
  const now    = Math.floor(Date.now() / 1000);
  const active = drops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > now).length;
  const totalG = drops.reduce((s, d) => s + d.amount, 0n);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${CARD} w-full p-5 text-left cursor-pointer motion-safe:transition-shadow
        hover:shadow-[0px_0px_16px_0px_#00000014] focus-visible:ring-2 focus-visible:ring-brand/40 outline-none`}
    >
      <div className="flex items-center gap-4">
        <CampaignDisc campaign={campaign} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg/none text-heading">{campaign.name}</p>
          {campaign.description && (
            <p className="mt-2 truncate text-sm/none text-nav-muted">{campaign.description}</p>
          )}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-nav-muted" strokeWidth={1.75} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`flex items-center gap-2 rounded-full px-3.5 py-2.5 text-sm/none ${active > 0 ? "bg-brand-soft text-brand" : "border border-line text-nav-muted"}`}>
          <span className={active > 0 ? "text-brand" : "text-heading"}>{active}</span> active
        </span>
        <Chip value={String(drops.length)} label="drops" />
        <Chip value={String(claims)} label="claimed" />
        <Chip value={gLabel(totalG)} label="hidden" />
        {campaign.goodcollectivePool && (
          <span className="flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-2.5 text-sm/none text-heading">
            <HeartHandshake className="h-4 w-4" strokeWidth={2} /> GoodCollective
          </span>
        )}
      </div>
    </button>
  );
}

// ── Claims chart ─────────────────────────────────────────────────────────────

function ClaimsChart({ drops }: { drops: Drop[] }) {
  const now = Math.floor(Date.now() / 1000);
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (6 - i) * 86400;
    const dayEnd   = dayStart + 86400;
    return {
      label: new Date(dayStart * 1000).toLocaleDateString("en", { weekday: "short" }),
      count: drops.filter(d => d.claimedAt > 0 && d.claimedAt >= dayStart && d.claimedAt < dayEnd).length,
    };
  });
  const max = Math.max(...buckets.map(b => b.count), 1);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div className={`${CARD} p-6`}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-xl/none text-heading">Claims</h2>
        <span className="rounded-full bg-surface px-3.5 py-2.5 text-sm/none text-heading">
          {total} <span className="text-nav-muted">in 7 days</span>
        </span>
      </div>
      <div className="flex h-24 items-end gap-2" role="img" aria-label={`${total} claims in the last 7 days`}>
        {buckets.map(({ label, count }) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-2">
            <div
              title={`${count} claim${count === 1 ? "" : "s"}`}
              className={`w-full rounded-full motion-safe:transition-[height] ${count > 0 ? "bg-brand" : "bg-surface"}`}
              style={{ height: count > 0 ? `${Math.max(8, (count / max) * 72)}px` : "6px" }}
            />
            <span className="text-xs/none text-nav-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Campaign drop list ────────────────────────────────────────────────────────

function CampaignDropList({ drops }: { drops: Drop[] }) {
  const now = Math.floor(Date.now() / 1000);
  if (!drops.length) return (
    <div className="flex flex-col items-center gap-y-4 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-heading">
        <MapPin className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <p className="text-lg/none text-heading">No drops yet</p>
      <p className="max-w-[260px] text-sm/[140%] text-nav-muted">
        Tap Add drops to place the first one on the map.
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {drops.map((d) => {
        const isActive  = d.status === DROP_STATUS.Active && d.expiry > now;
        const isClaimed = d.status === DROP_STATUS.Claimed;
        const { hint }  = parseDropHint(d.hint);
        const tier = dropTier(d.amount);
        const statusLabel = isActive ? "Active" : isClaimed ? "Claimed" : "Expired";

        return (
          <div key={String(d.id)} className="flex items-center gap-3 rounded-full border border-line p-2 pr-3">
            <span
              className="flex h-11.5 shrink-0 items-center justify-center rounded-full border px-3 text-xs/none"
              style={isActive
                ? { background: tier.bg, borderColor: tier.border, color: tier.text }
                : { background: "#F5F5F5", borderColor: "#F5F5F5", color: "#6B6E63" }}
            >
              {formatG$(d.amount)} G$
            </span>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm/none ${hint ? "text-heading" : "text-nav-muted italic"}`}>
                {hint || "No clue left"}
              </p>
              <p className="mt-2 truncate text-xs/none text-nav-muted">
                Drop #{String(d.id)} · expires {new Date(d.expiry * 1000).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-2 text-xs/none ${
                isActive ? "bg-brand-soft text-brand" : isClaimed ? "bg-surface text-nav-muted" : "bg-[#FFF0F0] text-danger"
              }`}
            >
              {statusLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-20">{children}</div>
      </div>
    </div>
  );
}

const VALUE_PROPS = [
  { Icon: MapPin, title: "Place drops anywhere", desc: "Pin G$ to exact GPS coordinates — your entrance, your table, your event." },
  { Icon: Users, title: "Verified humans hunt them", desc: "GoodDollar-verified people see your drops and walk to claim them in real life." },
  { Icon: BarChart3, title: "Track it in real time", desc: "See exactly who claimed, when, and how much G$ went out the door." },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SponsorPage() {
  const { address, isConnected } = useAccount();
  const { login, ready, authenticated } = useAuth();

  const [campaigns,      setCampaigns]      = useState<Campaign[]>([]);
  const [campaignClaims, setCampaignClaims] = useState<Record<string, number>>({});
  const [allDrops,       setAllDrops]       = useState<Drop[]>([]);
  const [loadingData,    setLoadingData]    = useState(false);
  const [selected,       setSelected]       = useState<Campaign | null>(null);
  const [view,           setView]           = useState<"list" | "create">("list");
  const [createDropOpen, setCreateDropOpen] = useState(false);

  const [formName,  setFormName]  = useState("");
  const [formDesc,  setFormDesc]  = useState("");
  const [formColor, setFormColor] = useState(ACCENT_COLORS[0].value);
  const [formLogo,  setFormLogo]  = useState("");
  const [formPool,  setFormPool]  = useState("");
  const [creating,  setCreating]  = useState(false);
  const [createErr, setCreateErr] = useState("");

  const fetchData = useCallback(async () => {
    if (!address) return;
    setLoadingData(true);
    try {
      const [campRes, drops] = await Promise.all([
        fetch(`/api/campaigns?owner=${address}`).then((r) => r.json()),
        fetchAllDrops(),
      ]);
      const fetched: Campaign[] = campRes.campaigns ?? [];
      setCampaigns(fetched);
      setAllDrops(drops);
      if (fetched.length > 0) {
        const results = await Promise.all(
          fetched.map((c) =>
            fetch(`/api/campaigns/${c.id}`).then((r) => r.json())
              .then((d) => ({ id: c.id, claims: d.claims ?? 0 }))
              .catch(() => ({ id: c.id, claims: 0 }))
          )
        );
        const map: Record<string, number> = {};
        results.forEach(({ id, claims }) => { map[id] = claims; });
        setCampaignClaims(map);
      }
    } catch (e) { console.error("[sponsor] fetchData failed", e); }
    finally { setLoadingData(false); }
  }, [address]);

  useEffect(() => { if (isConnected && address) fetchData(); }, [isConnected, address, fetchData]);

  async function handleCreateCampaign() {
    if (!address || !formName.trim()) return;
    setCreating(true); setCreateErr("");
    try {
      const res  = await fetch("/api/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName.trim(), description: formDesc.trim(), color: formColor, logo: formLogo.trim() || undefined, ownerAddress: address, goodcollectivePool: formPool.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setCreateErr(json.error ?? "Failed to create campaign"); return; }
      setCampaigns((prev) => [json.campaign, ...prev]);
      setSelected(json.campaign);
      setView("list");
      setFormName(""); setFormDesc(""); setFormLogo(""); setFormPool("");
      setFormColor(ACCENT_COLORS[0].value);
    } catch { setCreateErr("Network error — try again"); }
    finally { setCreating(false); }
  }

  const dropsForCampaign = (c: Campaign) =>
    allDrops.filter((d) => parseDropHint(d.hint).campaignId === c.id);

  // ── Settling auth ──────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <Shell>
        <Skeleton className="mb-6 h-9 w-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.16fr] lg:gap-12">
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      </Shell>
    );
  }

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!authenticated || !address) {
    return (
      <Shell>
        <div className="mx-auto w-full max-w-[560px]">
          <h1 className="mb-6 text-[32px]/none text-heading lg:text-4xl/none">Campaigns</h1>
          <div className={`${CARD} p-6 text-center`}>
            <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Flag className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <p className="text-xl/none text-heading">GoodDrops for business</p>
            <p className="mx-auto mt-3 max-w-[360px] text-sm/[140%] text-nav-muted">
              Drop G$ at your location and bring verified humans through your door.
            </p>
            <button type="button" onClick={login} className={`${PRIMARY} mx-auto mt-6 h-14 px-8 text-base/none`}>
              Sign in to start
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {VALUE_PROPS.map(({ Icon, title, desc }) => (
              <div key={title} className={`${CARD} flex items-start gap-4 p-5`}>
                <span className="flex h-11.5 w-11.5 shrink-0 items-center justify-center rounded-full bg-surface text-heading">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-base/none text-heading">{title}</p>
                  <p className="mt-2 text-sm/[140%] text-nav-muted">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  // ── Campaign detail ────────────────────────────────────────────────────────
  if (selected) {
    const now      = Math.floor(Date.now() / 1000);
    const campDrops = dropsForCampaign(selected);
    const active   = campDrops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > now).length;
    const claimed  = campDrops.filter((d) => d.status === DROP_STATUS.Claimed).length;
    const totalG   = campDrops.reduce((s, d) => s + d.amount, 0n);

    return (
      <Shell>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 lg:gap-4">
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Back to campaigns"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-white
                text-heading motion-safe:transition-colors hover:bg-surface"
            >
              <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <CampaignDisc campaign={selected} size={44} />
            <h1 className="truncate text-2xl/none text-heading lg:text-4xl/none">{selected.name}</h1>
          </div>
          <button type="button" onClick={() => setCreateDropOpen(true)} className={`${PRIMARY} shrink-0`}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            <span className="hidden sm:inline">Add drops</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <Chip value={String(active)} label="Active drops" loading={loadingData} />
          <Chip value={String(claimed)} label="Claimed" loading={loadingData} />
          <Chip value={gLabel(totalG)} label="Hidden" loading={loadingData} />
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.16fr_1fr] lg:gap-12">
          <div className="flex min-w-0 flex-col gap-6">
            <ClaimsChart drops={campDrops} />
            <div className={`${CARD} p-6`}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="text-xl/none text-heading">Drops</h2>
                {loadingData && <Loader2 className="h-4 w-4 animate-spin text-nav-muted" />}
              </div>
              {loadingData && campDrops.length === 0 ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 rounded-full" />)}
                </div>
              ) : (
                <CampaignDropList drops={campDrops} />
              )}
            </div>
          </div>

          <div className={`${CARD} min-w-0 p-6`}>
            <h2 className="mb-5 text-xl/none text-heading">About this campaign</h2>
            <p className="text-sm/[140%] text-nav-muted">
              {selected.description || "No description yet."}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <div className="flex items-center gap-3 rounded-full border border-line p-2 pr-5">
                <span className="h-11.5 w-11.5 shrink-0 rounded-full" style={{ background: selected.color }} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm/none text-heading">Brand colour</p>
                  <p className="mt-2 text-xs/none text-nav-muted">Painted on this campaign&apos;s pins</p>
                </div>
              </div>
              {selected.goodcollectivePool && (
                <div className="flex items-center gap-3 rounded-full border border-line p-2 pr-5">
                  <span className="flex h-11.5 w-11.5 shrink-0 items-center justify-center rounded-full bg-surface text-heading">
                    <HeartHandshake className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm/none text-heading">GoodCollective pool</p>
                    <p className="mt-2 truncate text-xs/none text-nav-muted">{selected.goodcollectivePool}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 rounded-full border border-line p-2 pr-5">
                <span className="flex h-11.5 w-11.5 shrink-0 items-center justify-center rounded-full bg-surface text-heading">
                  <Sparkles className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm/none text-heading">Created</p>
                  <p className="mt-2 text-xs/none text-nav-muted">
                    {selected.createdAt
                      ? new Date(selected.createdAt * (selected.createdAt < 1e12 ? 1000 : 1)).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })
                      : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <BatchDropCreator
          open={createDropOpen}
          campaign={selected}
          onClose={() => setCreateDropOpen(false)}
          onSuccess={() => { setCreateDropOpen(false); fetchData(); }}
        />
      </Shell>
    );
  }

  // ── Main dashboard ─────────────────────────────────────────────────────────

  // Aggregate stats across all campaigns
  const now         = Math.floor(Date.now() / 1000);
  const allCampDrops = campaigns.flatMap(dropsForCampaign);
  const totalActive  = allCampDrops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > now).length;
  const totalHidden  = allCampDrops.reduce((s, d) => s + d.amount, 0n);
  const totalClaims  = Object.values(campaignClaims).reduce((s, n) => s + n, 0);
  const poolValid    = !formPool || /^0x[0-9a-fA-F]{40}$/.test(formPool);
  const canCreate    = !creating && !!formName.trim() && poolValid;

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-[32px]/none text-heading lg:text-4xl/none">Campaigns</h1>
        <button
          type="button"
          onClick={() => setView(view === "create" ? "list" : "create")}
          className={view === "create" ? SECONDARY : PRIMARY}
        >
          {view === "create" ? "Cancel" : <><Plus className="h-4 w-4" strokeWidth={2} /> New campaign</>}
        </button>
      </div>

      {campaigns.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          <Chip value={String(totalActive)} label="Active drops" loading={loadingData} />
          <Chip value={String(totalClaims)} label="Claimed" loading={loadingData} />
          <Chip value={gLabel(totalHidden)} label="Distributed" loading={loadingData} />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_1.16fr] lg:gap-12">
        {/* ── List ──────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-3 lg:order-1">
          {loadingData && campaigns.length === 0 ? (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 rounded-3xl" />)
          ) : campaigns.length === 0 ? (
            <div className={`${CARD} flex flex-col items-center gap-y-4 p-8 text-center`}>
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
                <Flag className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <p className="text-xl/none text-heading">No campaigns yet</p>
              <p className="max-w-[300px] text-sm/[140%] text-nav-muted">
                Create your first campaign to start placing sponsored G$ drops on the map.
              </p>
              {view !== "create" && (
                <button type="button" onClick={() => setView("create")} className={`${PRIMARY} mt-2`}>
                  <Plus className="h-4 w-4" strokeWidth={2} /> Create a campaign
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="px-1 text-sm/none text-nav-muted">
                {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
              </p>
              {campaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  drops={dropsForCampaign(c)}
                  claims={campaignClaims[c.id] ?? 0}
                  onSelect={() => setSelected(c)}
                />
              ))}
            </>
          )}
        </div>

        {/* ── Create form / how it works ─────────────────────────────────── */}
        <div className={`min-w-0 lg:order-2 ${view === "create" ? "-order-1" : "order-1"}`}>
          {view === "create" ? (
            <form
              className={`${CARD} p-6`}
              onSubmit={(e) => { e.preventDefault(); if (canCreate) handleCreateCampaign(); }}
            >
              <h2 className="mb-6 text-xl/none text-heading">New campaign</h2>

              <div className="flex flex-col gap-5">
                <div>
                  <FieldLabel hint={`${formName.length}/60`}>Name</FieldLabel>
                  <input
                    type="text" value={formName}
                    onChange={(e) => setFormName(e.target.value.slice(0, 60))}
                    placeholder="Grand opening · Lagos coffee run"
                    aria-label="Campaign name"
                    className={FIELD}
                  />
                </div>

                <div>
                  <FieldLabel hint={`${formDesc.length}/280`}>Description</FieldLabel>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value.slice(0, 280))}
                    placeholder="What is this campaign about? Hunters see this when they find your drop."
                    rows={3}
                    aria-label="Campaign description"
                    className="w-full resize-none rounded-3xl border border-transparent bg-surface px-5 py-4 text-base/[140%] text-heading
                      placeholder:text-nav-muted outline-none focus:border-brand motion-safe:transition-colors"
                  />
                </div>

                <div>
                  <FieldLabel>Brand colour</FieldLabel>
                  <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Brand colour">
                    {ACCENT_COLORS.map(({ label, value }) => {
                      const on = formColor === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={label}
                          title={label}
                          onClick={() => setFormColor(value)}
                          className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-full motion-safe:transition-shadow
                            ${on ? "ring-2 ring-brand ring-offset-2 ring-offset-white" : "hover:ring-2 hover:ring-line"}`}
                          style={{ background: value }}
                        >
                          {on && <Check className="h-4 w-4 text-heading" strokeWidth={2.5} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <FieldLabel>Logo URL <span className="text-nav-muted">(optional)</span></FieldLabel>
                  <input
                    type="url" value={formLogo}
                    onChange={(e) => setFormLogo(e.target.value)}
                    placeholder="https://yourbrand.com/logo.png"
                    aria-label="Logo URL"
                    className={FIELD}
                  />
                </div>

                <div>
                  <FieldLabel>GoodCollective pool <span className="text-nav-muted">(optional)</span></FieldLabel>
                  <input
                    type="text" value={formPool}
                    onChange={(e) => setFormPool(e.target.value.trim())}
                    placeholder="0x… your GoodCollective pool"
                    aria-label="GoodCollective pool address"
                    aria-invalid={!poolValid}
                    className={FIELD}
                  />
                  <p className={`mt-3 h-4 px-5 text-sm/none ${poolValid ? "text-nav-muted" : "text-danger"}`}>
                    {poolValid ? "" : "Must be a valid 0x address"}
                  </p>
                </div>

                {/* Preview — the card hunters and the list will show. */}
                <div className="flex items-center gap-3 rounded-full border border-line p-2 pr-5">
                  <CampaignDisc
                    campaign={{ id: "", name: formName || "?", description: formDesc, color: formColor, logo: formLogo || undefined, ownerAddress: "", createdAt: 0 }}
                    size={46}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm/none text-heading">{formName || "Campaign name"}</p>
                    <p className="mt-2 truncate text-xs/none text-nav-muted">{formDesc || "Your description"}</p>
                  </div>
                </div>

                <p role="status" aria-live="polite" className="min-h-4 text-sm/[140%] text-danger">{createErr}</p>

                <button
                  type="submit"
                  disabled={!canCreate}
                  className={`${PRIMARY} h-14 w-full text-base/none`}
                >
                  {creating ? <><Loader2 className="h-5 w-5 animate-spin" /> Creating…</> : "Create campaign"}
                </button>
              </div>
            </form>
          ) : (
            <div className={`${CARD} p-6`}>
              <h2 className="mb-5 text-xl/none text-heading">How campaigns work</h2>
              <div className="flex flex-col gap-2">
                {[
                  { n: 1, title: "Create a campaign", desc: "Name it, pick a brand colour, add your logo." },
                  { n: 2, title: "Place drops on the map", desc: "Tap anywhere to queue drops, set amounts and clues, deploy them in one go." },
                  { n: 3, title: "Watch the claims roll in", desc: "Every claim shows up here, by day, with the G$ that went out." },
                ].map(({ n, title, desc }) => (
                  <div key={n} className="flex items-start gap-3 rounded-2xl p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-sm/none text-heading">{n}</span>
                    <div className="min-w-0">
                      <p className="text-base/none text-heading">{title}</p>
                      <p className="mt-2 text-sm/[140%] text-nav-muted">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
