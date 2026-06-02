"use client";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, Plus, BarChart2, Sparkles, ChevronRight, ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { Nav } from "@/components/Nav";

const BatchDropCreator = dynamic(
  () => import("@/components/BatchDropCreator").then((m) => ({ default: m.BatchDropCreator })),
  { ssr: false }
);
import { formatG$, parseDropHint } from "@/lib/utils";
import { fetchAllDrops } from "@/lib/subgraph";
import { DROP_STATUS, type Campaign, type Drop } from "@/types";
import clsx from "clsx";

const ACCENT_COLORS = [
  { label: "Lime",   value: "#BFFD00" },
  { label: "Orange", value: "#FF6400" },
  { label: "Sky",    value: "#00CFFF" },
  { label: "Gold",   value: "#FFD700" },
  { label: "Coral",  value: "#FF3B6B" },
];

// ── Campaign card ─────────────────────────────────────────────────────────────

function CampaignCard({
  campaign, drops, claims, onSelect,
}: {
  campaign: Campaign;
  drops: Drop[];
  claims: number;
  onSelect: () => void;
}) {
  const active  = drops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > Math.floor(Date.now() / 1000)).length;
  const totalG$ = drops.reduce((s, d) => s + d.amount, 0n);

  return (
    <button
      onClick={onSelect}
      style={{ borderLeft: `4px solid ${campaign.color}` }}
      className="w-full text-left bg-card border-2 border-ink rounded-xl p-4 shadow-brutal-sm hover:shadow-brutal transition-all flex items-center gap-4"
    >
      {campaign.logo ? (
        <img src={campaign.logo} alt="" className="w-12 h-12 rounded-lg object-cover border-2 border-ink shrink-0" />
      ) : (
        <div
          style={{ background: campaign.color }}
          className="w-12 h-12 rounded-lg border-2 border-ink flex items-center justify-center text-ink font-black text-xl shrink-0"
        >
          {campaign.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-black text-base truncate">{campaign.name}</p>
        {campaign.description && (
          <p className="text-xs text-muted truncate mt-0.5">{campaign.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs font-bold text-muted flex-wrap">
          <span className="text-lime bg-ink px-2 py-0.5 rounded-full">{active} active</span>
          <span>{drops.length} drops total</span>
          <span>{claims} claimed</span>
          <span>{formatG$(totalG$)} G$ hidden</span>
          {campaign.goodcollectivePool && (
            <span className="text-ink bg-lime px-2 py-0.5 rounded-full">🤝 GoodCollective</span>
          )}
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </button>
  );
}

// ── Campaign drop list ────────────────────────────────────────────────────────

function CampaignDropList({ drops }: { drops: Drop[] }) {
  const now = Math.floor(Date.now() / 1000);
  if (!drops.length) return (
    <p className="text-sm text-muted text-center py-6">No drops yet — add your first one above!</p>
  );

  return (
    <div className="space-y-2">
      {drops.map((d) => {
        const isActive  = d.status === DROP_STATUS.Active && d.expiry > now;
        const isClaimed = d.status === DROP_STATUS.Claimed;
        const { hint }  = parseDropHint(d.hint);
        return (
          <div key={String(d.id)} className="bg-cream border-2 border-ink rounded-xl px-4 py-3 flex items-center gap-3">
            <div className={clsx(
              "w-2.5 h-2.5 rounded-full shrink-0",
              isActive ? "bg-lime" : isClaimed ? "bg-muted" : "bg-danger"
            )} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{hint || "No clue"}</p>
              <p className="text-xs text-muted">{formatG$(d.amount)} G$</p>
            </div>
            <span className={clsx(
              "text-xs font-bold px-2 py-0.5 rounded-full border",
              isActive  ? "bg-lime text-ink border-ink" :
              isClaimed ? "bg-border text-muted border-muted" :
                          "bg-danger/10 text-danger border-danger"
            )}>
              {isActive ? "Active" : isClaimed ? "Claimed" : "Expired"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SponsorPage() {
  const { address, isConnected } = useAccount();
  const { login, ready, authenticated } = usePrivy();

  const [campaigns, setCampaigns]       = useState<Campaign[]>([]);
  const [campaignClaims, setCampaignClaims] = useState<Record<string, number>>({});
  const [allDrops, setAllDrops]         = useState<Drop[]>([]);
  const [loadingData, setLoadingData]   = useState(false);
  const [selected, setSelected]         = useState<Campaign | null>(null);
  const [view, setView]                 = useState<"list" | "create">("list");
  const [createDropOpen, setCreateDropOpen] = useState(false);

  // ── Campaign creation form state ──────────────────────────────────────────
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
      const fetchedCampaigns: Campaign[] = campRes.campaigns ?? [];
      setCampaigns(fetchedCampaigns);
      setAllDrops(drops);

      // Fetch claim counts for each campaign
      if (fetchedCampaigns.length > 0) {
        const claimResults = await Promise.all(
          fetchedCampaigns.map((c) =>
            fetch(`/api/campaigns/${c.id}`)
              .then((r) => r.json())
              .then((d) => ({ id: c.id, claims: d.claims ?? 0 }))
              .catch(() => ({ id: c.id, claims: 0 }))
          )
        );
        const map: Record<string, number> = {};
        claimResults.forEach(({ id, claims }) => { map[id] = claims; });
        setCampaignClaims(map);
      }
    } catch (e) {
      console.error("[sponsor] fetchData failed", e);
    } finally {
      setLoadingData(false);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && address) fetchData();
  }, [isConnected, address, fetchData]);

  async function handleCreateCampaign() {
    if (!address || !formName.trim()) return;
    setCreating(true);
    setCreateErr("");
    try {
      const res  = await fetch("/api/campaigns", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:               formName.trim(),
          description:        formDesc.trim(),
          color:              formColor,
          logo:               formLogo.trim() || undefined,
          ownerAddress:       address,
          goodcollectivePool: formPool.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setCreateErr(json.error ?? "Failed to create campaign"); return; }
      setCampaigns((prev) => [json.campaign, ...prev]);
      setSelected(json.campaign);
      setView("list");
      setFormName(""); setFormDesc(""); setFormLogo(""); setFormPool("");
      setFormColor(ACCENT_COLORS[0].value);
    } catch {
      setCreateErr("Network error — try again");
    } finally {
      setCreating(false);
    }
  }

  const dropsForCampaign = (c: Campaign) =>
    allDrops.filter((d) => {
      const { campaignId } = parseDropHint(d.hint);
      return campaignId === c.id;
    });

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!ready) return null;

  if (!authenticated || !address) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 text-center gap-6 pt-14">
        <Nav />
        <div>
          <h1 className="text-4xl font-black tracking-tight">GoodDrops for Business</h1>
          <p className="text-muted mt-2 text-base max-w-xs mx-auto">
            Drop G$ at your location. Bring verified humans through your door.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 max-w-xs w-full text-left text-sm">
          {[
            { icon: "📍", text: "Place G$ drops anywhere on the map" },
            { icon: "🎯", text: "Verified GoodDollar users hunt them" },
            { icon: "📊", text: "Track claims and foot traffic in real time" },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-center gap-3 bg-card border-2 border-ink rounded-xl px-4 py-3">
              <span className="text-xl">{icon}</span>
              <span className="font-semibold">{text}</span>
            </div>
          ))}
        </div>
        <button
          onClick={login}
          className="btn-brutal bg-ink text-lime font-black px-8 py-4 rounded-2xl text-base"
        >
          Connect Wallet to Start
        </button>
      </div>
    );
  }

  // ── Campaign detail view ──────────────────────────────────────────────────
  if (selected) {
    const campDrops = dropsForCampaign(selected);
    const active    = campDrops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > Math.floor(Date.now() / 1000)).length;
    const claimed   = campDrops.filter((d) => d.status === DROP_STATUS.Claimed).length;
    const totalG$   = campDrops.reduce((s, d) => s + d.amount, 0n);

    return (
      <div className="min-h-screen bg-cream pt-14">
        <Nav />
        {/* Campaign header */}
        <div className="sticky top-14 z-10 bg-cream border-b-2 border-ink px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSelected(null)}
            className="w-9 h-9 rounded-full border-2 border-ink flex items-center justify-center hover:bg-ink hover:text-lime transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div
            style={{ background: selected.color }}
            className="w-8 h-8 rounded-lg border-2 border-ink flex items-center justify-center font-black text-sm shrink-0"
          >
            {selected.logo
              ? <img src={selected.logo} alt="" className="w-full h-full object-cover rounded" />
              : selected.name.charAt(0).toUpperCase()
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-base truncate">{selected.name}</p>
            <p className="text-xs text-muted truncate">{selected.description}</p>
          </div>
          <button
            onClick={() => setCreateDropOpen(true)}
            style={{ background: selected.color }}
            className="btn-brutal flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-black text-ink border-2 border-ink shrink-0"
          >
            <Plus size={14} />
            Add Drop
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 p-4">
          {[
            { label: "Active Drops", value: active,          color: "#BFFD00" },
            { label: "Claimed",      value: claimed,         color: "#00CFFF" },
            { label: "G$ Hidden",    value: formatG$(totalG$) + " G$", color: selected.color },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card border-2 border-ink rounded-xl p-3 text-center shadow-brutal-sm">
              <p className="text-2xl font-black" style={{ color }}>{value}</p>
              <p className="text-xs text-muted font-semibold mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Drops list */}
        <div className="px-4 pb-24">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-black text-sm uppercase tracking-wider text-muted">Campaign Drops</h3>
            {loadingData && <Loader2 size={14} className="animate-spin text-muted" />}
          </div>
          <CampaignDropList drops={campDrops} />
        </div>

        {/* Batch drop creator — full-screen, click-to-place */}
        <BatchDropCreator
          open={createDropOpen}
          campaign={selected}
          onClose={() => setCreateDropOpen(false)}
          onSuccess={() => { setCreateDropOpen(false); fetchData(); }}
        />
      </div>
    );
  }

  // ── Main list / create view ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream pt-14">
      <Nav />
      {/* Sponsor header */}
      <div className="sticky top-14 z-10 bg-cream border-b-2 border-ink px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight">Sponsor Dashboard</h1>
            <p className="text-xs text-muted mt-0.5">Drop G$ · Drive foot traffic · Build loyalty</p>
          </div>
          <button
            onClick={() => setView(view === "create" ? "list" : "create")}
            className={clsx(
              "btn-brutal flex items-center gap-2 px-4 py-2 rounded-xl font-black text-sm border-2 border-ink",
              view === "create" ? "bg-cream text-ink" : "bg-ink text-lime"
            )}
          >
            {view === "create" ? "Cancel" : <><Plus size={14} /> New Campaign</>}
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* ── Create campaign form ────────────────────────────────────────── */}
        {view === "create" && (
          <div className="bg-card border-2 border-ink rounded-2xl p-5 shadow-brutal space-y-5">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-lime" />
              <h2 className="font-black text-lg">New Campaign</h2>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted">Campaign Name *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value.slice(0, 60))}
                placeholder="e.g. Lagos Coffee Run · Grand Opening"
                className="w-full border-2 border-ink rounded-xl px-4 py-3 text-sm font-semibold bg-cream outline-none placeholder:text-muted placeholder:font-normal"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted">Description</label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value.slice(0, 280))}
                placeholder="What is this campaign about? Hunters will see this when they find your drop."
                rows={3}
                className="w-full border-2 border-ink rounded-xl px-4 py-3 text-sm bg-cream outline-none resize-none placeholder:text-muted"
              />
              <p className="text-xs text-muted text-right">{formDesc.length}/280</p>
            </div>

            {/* Accent color */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted">Brand Color</label>
              <div className="flex gap-2 flex-wrap">
                {ACCENT_COLORS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => setFormColor(value)}
                    title={label}
                    className={clsx(
                      "w-10 h-10 rounded-xl border-2 transition-all",
                      formColor === value ? "border-ink shadow-brutal-sm scale-110" : "border-transparent"
                    )}
                    style={{ background: value }}
                  />
                ))}
              </div>
            </div>

            {/* Logo URL */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted">Logo URL (optional)</label>
              <input
                type="url"
                value={formLogo}
                onChange={(e) => setFormLogo(e.target.value)}
                placeholder="https://yourbrand.com/logo.png"
                className="w-full border-2 border-ink rounded-xl px-4 py-3 text-sm bg-cream outline-none font-mono placeholder:font-sans placeholder:text-muted"
              />
            </div>

            {/* GoodCollective Pool */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                🤝 GoodCollective Pool Address
                <span className="font-normal text-muted normal-case tracking-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={formPool}
                onChange={(e) => setFormPool(e.target.value.trim())}
                placeholder="0x… your GoodCollective pool"
                className="w-full border-2 border-ink rounded-xl px-4 py-3 text-sm bg-cream outline-none font-mono placeholder:font-sans placeholder:text-muted"
              />
              {formPool && !/^0x[0-9a-fA-F]{40}$/.test(formPool) && (
                <p className="text-xs text-danger font-semibold">Must be a valid 0x address</p>
              )}
              <p className="text-xs text-muted">
                Link your GoodCollective community pool to display a 🤝 badge on your drops.{" "}
                <a href="https://goodcollective.xyz" target="_blank" rel="noopener noreferrer" className="underline">Learn more ↗</a>
              </p>
            </div>

            {/* Preview */}
            <div className="bg-cream border-2 border-dashed border-ink rounded-xl p-4 flex items-center gap-3">
              <div
                style={{ background: formColor }}
                className="w-12 h-12 rounded-lg border-2 border-ink flex items-center justify-center font-black text-xl shrink-0"
              >
                {formLogo
                  ? <img src={formLogo} alt="" className="w-full h-full object-cover rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : (formName.charAt(0).toUpperCase() || "?")
                }
              </div>
              <div>
                <p className="font-black text-sm">{formName || "Campaign name"}</p>
                <p className="text-xs text-muted mt-0.5 line-clamp-2">{formDesc || "Your description"}</p>
              </div>
            </div>

            {createErr && (
              <p className="text-sm text-danger font-semibold">{createErr}</p>
            )}

            <button
              onClick={handleCreateCampaign}
              disabled={creating || !formName.trim()}
              className={clsx(
                "btn-brutal w-full py-4 rounded-xl font-black text-base flex items-center justify-center gap-2",
                !creating && formName.trim() ? "bg-lime text-ink" : "bg-border text-muted cursor-not-allowed shadow-none"
              )}
              style={!formName.trim() ? { boxShadow: "none", transform: "none" } : {}}
            >
              {creating ? <><Loader2 size={16} className="animate-spin" /> Creating…</> : "Create Campaign →"}
            </button>
          </div>
        )}

        {/* ── Campaign list ───────────────────────────────────────────────── */}
        {view === "list" && (
          <div className="space-y-4">
            {loadingData ? (
              <div className="flex items-center justify-center py-12 gap-3 text-muted">
                <Loader2 size={20} className="animate-spin" />
                <span className="font-semibold">Loading campaigns…</span>
              </div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-16 space-y-4">
                <div className="text-6xl">🎯</div>
                <div>
                  <p className="font-black text-xl">No campaigns yet</p>
                  <p className="text-muted text-sm mt-1">Create your first campaign to start placing sponsored drops on the map.</p>
                </div>
                <button
                  onClick={() => setView("create")}
                  className="btn-brutal bg-ink text-lime font-black px-6 py-3 rounded-xl inline-flex items-center gap-2"
                >
                  <Plus size={16} />
                  Create First Campaign
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-muted font-semibold">
                  <BarChart2 size={14} />
                  <span>{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</span>
                </div>
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
        )}
      </div>
    </div>
  );
}
