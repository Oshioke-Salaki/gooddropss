"use client";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, Plus, ArrowLeft, Sparkles } from "lucide-react";
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

function CampaignCard({ campaign, drops, claims, onSelect }: {
  campaign: Campaign; drops: Drop[]; claims: number; onSelect: () => void;
}) {
  const now    = Math.floor(Date.now() / 1000);
  const active = drops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > now).length;
  const totalG = drops.reduce((s, d) => s + d.amount, 0n);

  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%", textAlign: "left",
        background: "#fff",
        border: "2px solid #111",
        borderLeft: `5px solid ${campaign.color}`,
        borderRadius: 16,
        boxShadow: "3px 3px 0 #111",
        padding: "16px 18px",
        cursor: "pointer", fontFamily: "inherit",
        transition: "box-shadow 0.1s, transform 0.1s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "1px 1px 0 #111"; e.currentTarget.style.transform = "translate(2px,2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "3px 3px 0 #111"; e.currentTarget.style.transform = "translate(0,0)"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {/* Logo / avatar */}
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: campaign.color, border: "2px solid #111",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 900, fontSize: 20, color: "#111", flexShrink: 0,
          overflow: "hidden",
        }}>
          {campaign.logo
            ? <img src={campaign.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : campaign.name.charAt(0).toUpperCase()
          }
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {campaign.name}
            </p>
            <span style={{ color: "#aaa", fontSize: 18, flexShrink: 0 }}>→</span>
          </div>
          {campaign.description && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {campaign.description}
            </p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {[
          { label: "Active",   value: String(active),           highlight: active > 0 },
          { label: "Drops",    value: String(drops.length),     highlight: false },
          { label: "Claimed",  value: String(claims),           highlight: false },
          { label: "Hidden",   value: formatG$(totalG) + " G$", highlight: false },
        ].map(({ label, value, highlight }) => (
          <div key={label} style={{
            background: highlight ? campaign.color : "#f5f4f0",
            border: `1.5px solid ${highlight ? "#111" : "#e0ddd8"}`,
            borderRadius: 8, padding: "4px 10px",
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <span style={{ fontWeight: 900, fontSize: 13, color: "#111" }}>{value}</span>
            <span style={{ fontWeight: 600, fontSize: 11, color: "#888" }}>{label}</span>
          </div>
        ))}
        {campaign.goodcollectivePool && (
          <div style={{ background: "#111", border: "1.5px solid #111", borderRadius: 8, padding: "4px 10px" }}>
            <span style={{ fontWeight: 800, fontSize: 11, color: "#BFFD00" }}>🤝 GoodCollective</span>
          </div>
        )}
      </div>
    </button>
  );
}

// ── Claims chart ─────────────────────────────────────────────────────────────

function ClaimsChart({ drops, color }: { drops: Drop[]; color: string }) {
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
    <div style={{
      background: "#111", border: "2px solid #222",
      borderRadius: 14, padding: "16px 18px", marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Claims — last 7 days
        </p>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: color }}>
          {total} total
        </p>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 64 }}>
        {buckets.map(({ label, count }) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <div style={{
              width: "100%",
              height: count > 0 ? `${Math.max(4, (count / max) * 48)}px` : "3px",
              background: count > 0 ? color : "#222",
              borderRadius: 4,
              transition: "height 0.4s ease",
            }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: "#444", textTransform: "uppercase" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Campaign drop list ────────────────────────────────────────────────────────

function CampaignDropList({ drops, color }: { drops: Drop[]; color: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (!drops.length) return (
    <div style={{
      background: "#fff", border: "2px dashed #ddd",
      borderRadius: 16, padding: "40px 20px", textAlign: "center",
    }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>📍</div>
      <p style={{ fontWeight: 800, fontSize: 15, color: "#111", margin: "0 0 4px" }}>No drops yet</p>
      <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Tap "Add Drops" to place your first drop on the map.</p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {drops.map((d) => {
        const isActive  = d.status === DROP_STATUS.Active && d.expiry > now;
        const isClaimed = d.status === DROP_STATUS.Claimed;
        const { hint }  = parseDropHint(d.hint);

        const statusColor = isActive ? color : isClaimed ? "#888" : "#FF3B3B";
        const statusLabel = isActive ? "Active" : isClaimed ? "Claimed" : "Expired";

        return (
          <div key={String(d.id)} style={{
            background: "#fff",
            border: "2px solid #111",
            borderLeft: `5px solid ${statusColor}`,
            borderRadius: 14,
            padding: "13px 16px",
            display: "flex", alignItems: "center", gap: 14,
            boxShadow: isActive ? "2px 2px 0 #111" : "none",
          }}>
            {/* Amount bubble */}
            <div style={{
              width: 46, height: 46, borderRadius: 12, flexShrink: 0,
              background: isActive ? color : "#f0f0f0",
              border: `2px solid ${isActive ? "#111" : "#ddd"}`,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 0,
            }}>
              <span style={{ fontWeight: 900, fontSize: 13, color: isActive ? "#111" : "#aaa", lineHeight: 1.1 }}>
                {formatG$(d.amount)}
              </span>
              <span style={{ fontWeight: 700, fontSize: 9, color: isActive ? "#111" : "#aaa", opacity: 0.7 }}>G$</span>
            </div>

            {/* Hint + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: "0 0 3px", fontSize: 14, fontWeight: 700, color: "#111",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {hint || <span style={{ color: "#bbb", fontStyle: "italic", fontWeight: 500 }}>No clue left</span>}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "#aaa", fontWeight: 600 }}>
                Drop #{String(d.id)} · expires {new Date(d.expiry * 1000).toLocaleDateString()}
              </p>
            </div>

            {/* Status badge */}
            <span style={{
              fontSize: 10, fontWeight: 900,
              padding: "4px 10px", borderRadius: 100,
              background: isActive ? color : isClaimed ? "#f5f5f5" : "#FFE5E5",
              color: isActive ? "#111" : isClaimed ? "#888" : "#FF3B3B",
              border: `1.5px solid ${isActive ? "#111" : isClaimed ? "#ddd" : "#FF3B3B"}`,
              textTransform: "uppercase", letterSpacing: "0.08em",
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {statusLabel}
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

  if (!ready) return null;

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!authenticated || !address) {
    return (
      <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif", paddingTop: 56 }}>
        <Nav />
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px 40px", textAlign: "center" }}>
          {/* Hero */}
          <div style={{
            background: "#111", border: "2px solid #111",
            borderRadius: 20, boxShadow: "4px 4px 0 #BFFD00",
            padding: "36px 24px", marginBottom: 28,
          }}>
            <p style={{ margin: "0 0 16px", fontSize: 11, fontWeight: 800, color: "#555", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              For Businesses
            </p>
            <h1 style={{ margin: "0 0 12px", fontSize: 32, fontWeight: 900, color: "#BFFD00", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
              GoodDrops<br />for Business
            </h1>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "#888", lineHeight: 1.6 }}>
              Drop G$ at your location. Bring verified humans through your door.
            </p>
            <button
              onClick={login}
              style={{
                width: "100%", padding: "15px",
                background: "#BFFD00", color: "#111",
                border: "2px solid #BFFD00", borderRadius: 14,
                boxShadow: "3px 3px 0 rgba(191,253,0,0.4)",
                fontWeight: 900, fontSize: 16,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Connect Wallet to Start
            </button>
          </div>

          {/* Value props */}
          {[
            { icon: "📍", title: "Place drops anywhere", desc: "Pin G$ to exact GPS coordinates on the map — your entrance, your table, your event." },
            { icon: "🎯", title: "Verified humans hunt them", desc: "GoodDollar-verified users see your drops and walk to claim them in real life." },
            { icon: "📊", title: "Track in real time", desc: "See exactly who claimed, when, and how much G$ was distributed." },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{
              background: "#fff", border: "2px solid #111",
              borderRadius: 14, padding: "16px 18px",
              marginBottom: 10, textAlign: "left",
              display: "flex", gap: 14, alignItems: "flex-start",
            }}>
              <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>{icon}</span>
              <div>
                <p style={{ margin: "0 0 3px", fontWeight: 800, fontSize: 14, color: "#111" }}>{title}</p>
                <p style={{ margin: 0, fontSize: 12, color: "#888", lineHeight: 1.5 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
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
      <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif", paddingTop: 56 }}>
        <Nav />

        {/* Campaign header */}
        <div style={{
          position: "sticky", top: 56, zIndex: 10,
          background: "#111",
          borderBottom: "2px solid #111",
          borderTop: `4px solid ${selected.color}`,
          padding: "12px 20px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <button
            onClick={() => setSelected(null)}
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(255,255,255,0.08)", border: "1.5px solid #333",
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#888",
            }}
          >
            <ArrowLeft size={15} color="#888" />
          </button>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: selected.color, border: "2px solid rgba(255,255,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 14, color: "#111", flexShrink: 0, overflow: "hidden",
          }}>
            {selected.logo
              ? <img src={selected.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : selected.name.charAt(0).toUpperCase()
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 15, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.name}
            </p>
            {selected.description && (
              <p style={{ margin: 0, fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selected.description}
              </p>
            )}
          </div>
          <button
            onClick={() => setCreateDropOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: selected.color, color: "#111",
              border: "2px solid rgba(255,255,255,0.15)", borderRadius: 10,
              padding: "8px 14px", fontWeight: 900, fontSize: 13,
              cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
              boxShadow: `2px 2px 0 ${selected.color}50`,
            }}
          >
            <Plus size={14} />
            Add Drops
          </button>
        </div>

        <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 80px" }}>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
            {[
              { label: "Active Drops", value: active,                   color: selected.color },
              { label: "Claimed",      value: claimed,                  color: "#00CFFF" },
              { label: "G$ Hidden",    value: formatG$(totalG) + " G$", color: "#fff" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: "#111", border: "2px solid #222",
                borderRadius: 14, padding: "14px 12px", textAlign: "center",
              }}>
                <p style={{ margin: "0 0 3px", fontWeight: 900, fontSize: 22, color, letterSpacing: "-0.02em" }}>{value}</p>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
              </div>
            ))}
          </div>

          <ClaimsChart drops={campDrops} color={selected.color} />

          {/* Drops */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Campaign Drops
            </p>
            {loadingData && <Loader2 size={13} style={{ animation: "spin 1s linear infinite", color: "#aaa" }} />}
          </div>
          <CampaignDropList drops={campDrops} color={selected.color} />
        </div>

        <BatchDropCreator
          open={createDropOpen}
          campaign={selected}
          onClose={() => setCreateDropOpen(false)}
          onSuccess={() => { setCreateDropOpen(false); fetchData(); }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Main dashboard ─────────────────────────────────────────────────────────

  // Aggregate stats across all campaigns
  const now         = Math.floor(Date.now() / 1000);
  const allCampDrops = campaigns.flatMap(dropsForCampaign);
  const totalActive  = allCampDrops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > now).length;
  const totalHidden  = allCampDrops.reduce((s, d) => s + d.amount, 0n);
  const totalClaims  = Object.values(campaignClaims).reduce((s, n) => s + n, 0);

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif", paddingTop: 56 }}>
      <Nav />

      {/* ── Dashboard header ──────────────────────────────────────────────── */}
      <div style={{
        background: "#111",
        borderBottom: "2px solid #111",
        borderTop: "4px solid #BFFD00",
        padding: "20px 24px 20px",
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: campaigns.length > 0 ? 20 : 0 }}>
            <div>
              <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 800, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                Sponsor Dashboard
              </p>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>
                Drop G$ · Drive traffic
              </h1>
            </div>
            <button
              onClick={() => setView(view === "create" ? "list" : "create")}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: view === "create" ? "transparent" : "#BFFD00",
                color: view === "create" ? "#555" : "#111",
                border: "2px solid",
                borderColor: view === "create" ? "#333" : "#BFFD00",
                borderRadius: 12, padding: "10px 16px",
                fontWeight: 900, fontSize: 13,
                cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
                boxShadow: view === "create" ? "none" : "3px 3px 0 rgba(191,253,0,0.3)",
              }}
            >
              {view === "create" ? "Cancel" : <><Plus size={14} /> New Campaign</>}
            </button>
          </div>

          {/* Aggregate stats — only when there are campaigns */}
          {campaigns.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {[
                { label: "Active Drops", value: totalActive,                    accent: "#BFFD00" },
                { label: "Total Claimed", value: totalClaims,                   accent: "#00CFFF" },
                { label: "G$ Distributed", value: formatG$(totalHidden) + " G$", accent: "#fff" },
              ].map(({ label, value, accent }) => (
                <div key={label} style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1.5px solid #222",
                  borderRadius: 12, padding: "12px 14px",
                }}>
                  <p style={{ margin: "0 0 2px", fontWeight: 900, fontSize: 20, color: accent, letterSpacing: "-0.02em" }}>{value}</p>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 80px" }}>

        {/* ── Create campaign form ─────────────────────────────────────────── */}
        {view === "create" && (
          <div style={{
            background: "#fff", border: "2px solid #111",
            borderRadius: 20, boxShadow: "4px 4px 0 #111",
            padding: "22px 20px", marginBottom: 24,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <Sparkles size={18} color="#BFFD00" />
              <h2 style={{ margin: 0, fontWeight: 900, fontSize: 18 }}>New Campaign</h2>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Name */}
              <div>
                <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>Campaign Name *</p>
                <input
                  type="text" value={formName}
                  onChange={(e) => setFormName(e.target.value.slice(0, 60))}
                  placeholder="e.g. Grand Opening · Lagos Coffee Run"
                  style={{ width: "100%", padding: "11px 14px", border: "2px solid #111", borderRadius: 12, fontSize: 14, fontWeight: 600, background: "#f5f4f0", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                />
              </div>

              {/* Description */}
              <div>
                <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>Description</p>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value.slice(0, 280))}
                  placeholder="What is this campaign about? Hunters will see this when they find your drop."
                  rows={3}
                  style={{ width: "100%", padding: "11px 14px", border: "2px solid #111", borderRadius: 12, fontSize: 13, background: "#f5f4f0", outline: "none", resize: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                />
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#aaa", textAlign: "right" }}>{formDesc.length}/280</p>
              </div>

              {/* Brand color */}
              <div>
                <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>Brand Color</p>
                <div style={{ display: "flex", gap: 8 }}>
                  {ACCENT_COLORS.map(({ label, value }) => (
                    <button
                      key={value}
                      onClick={() => setFormColor(value)}
                      title={label}
                      style={{
                        width: 40, height: 40, borderRadius: 12, background: value,
                        border: `2.5px solid ${formColor === value ? "#111" : "transparent"}`,
                        boxShadow: formColor === value ? "2px 2px 0 #111" : "none",
                        cursor: "pointer", transform: formColor === value ? "scale(1.1)" : "scale(1)",
                        transition: "all 0.1s",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Logo URL */}
              <div>
                <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>Logo URL (optional)</p>
                <input
                  type="url" value={formLogo}
                  onChange={(e) => setFormLogo(e.target.value)}
                  placeholder="https://yourbrand.com/logo.png"
                  style={{ width: "100%", padding: "11px 14px", border: "2px solid #111", borderRadius: 12, fontSize: 13, background: "#f5f4f0", outline: "none", fontFamily: "monospace", boxSizing: "border-box" }}
                />
              </div>

              {/* GoodCollective */}
              <div>
                <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  🤝 GoodCollective Pool <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: "normal" }}>(optional)</span>
                </p>
                <input
                  type="text" value={formPool}
                  onChange={(e) => setFormPool(e.target.value.trim())}
                  placeholder="0x… your GoodCollective pool"
                  style={{ width: "100%", padding: "11px 14px", border: "2px solid #111", borderRadius: 12, fontSize: 13, background: "#f5f4f0", outline: "none", fontFamily: "monospace", boxSizing: "border-box" }}
                />
                {formPool && !/^0x[0-9a-fA-F]{40}$/.test(formPool) && (
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#FF3B3B", fontWeight: 700 }}>Must be a valid 0x address</p>
                )}
              </div>

              {/* Preview */}
              <div style={{ background: "#f5f4f0", border: "2px dashed #111", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: formColor, border: "2px solid #111",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 900, fontSize: 20, flexShrink: 0, overflow: "hidden",
                }}>
                  {formLogo
                    ? <img src={formLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    : (formName.charAt(0).toUpperCase() || "?")
                  }
                </div>
                <div>
                  <p style={{ margin: "0 0 2px", fontWeight: 900, fontSize: 14, color: "#111" }}>{formName || "Campaign name"}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#888" }}>{formDesc || "Your description"}</p>
                </div>
              </div>

              {createErr && <p style={{ margin: 0, fontSize: 13, color: "#FF3B3B", fontWeight: 700 }}>{createErr}</p>}

              <button
                onClick={handleCreateCampaign}
                disabled={creating || !formName.trim()}
                style={{
                  width: "100%", padding: "15px",
                  background: !creating && formName.trim() ? "#BFFD00" : "#e8e6e0",
                  color: !creating && formName.trim() ? "#111" : "#aaa",
                  border: "2px solid",
                  borderColor: !creating && formName.trim() ? "#111" : "#ddd",
                  borderRadius: 14,
                  boxShadow: !creating && formName.trim() ? "3px 3px 0 #111" : "none",
                  fontWeight: 900, fontSize: 15,
                  cursor: creating || !formName.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {creating ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Creating…</> : "Create Campaign →"}
              </button>
            </div>
          </div>
        )}

        {/* ── Campaign list ────────────────────────────────────────────────── */}
        {view === "list" && (
          <>
            {loadingData ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 10, color: "#888" }}>
                <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>Loading campaigns…</span>
              </div>
            ) : campaigns.length === 0 ? (
              <div style={{
                background: "#111", border: "2px solid #111",
                borderRadius: 20, boxShadow: "4px 4px 0 #BFFD00",
                padding: "48px 24px", textAlign: "center",
              }}>
                <div style={{ fontSize: 52, marginBottom: 14 }}>🎯</div>
                <p style={{ margin: "0 0 6px", fontWeight: 900, fontSize: 22, color: "#fff" }}>No campaigns yet</p>
                <p style={{ margin: "0 0 24px", fontSize: 13, color: "#666", lineHeight: 1.6 }}>
                  Create your first campaign to start placing sponsored G$ drops on the map.
                </p>
                <button
                  onClick={() => setView("create")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    background: "#BFFD00", color: "#111",
                    border: "2px solid #BFFD00", borderRadius: 12,
                    padding: "12px 24px", fontWeight: 900, fontSize: 14,
                    cursor: "pointer", fontFamily: "inherit",
                    boxShadow: "3px 3px 0 rgba(191,253,0,0.3)",
                  }}
                >
                  <Plus size={16} /> Create First Campaign
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>
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
              </div>
            )}
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
