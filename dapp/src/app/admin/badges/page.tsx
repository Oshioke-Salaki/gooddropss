"use client";
import { useState, useEffect, useCallback } from "react";
import type { BadgeDef, BadgeSetDef, BadgeRule } from "@/lib/badges";

// Admin · Badges — see every badge (builtin + custom), create event/venue
// badges and collections (sets), and watch holder counts. Builtins are code-
// defined and read-only; customs power event collections & venue quests.

type RuleType = BadgeRule["type"];
const RULE_OPTIONS: { value: RuleType; label: string; params: ("n" | "g" | "dropIds" | "geo" | "campaign" | "seconds")[] }[] = [
  { value: "claims_at_least",        label: "Claimed ≥ N drops",             params: ["n"] },
  { value: "gd_claimed_at_least",    label: "Found ≥ G total G$",            params: ["g"] },
  { value: "drops_at_least",         label: "Created ≥ N drops",             params: ["n"] },
  { value: "single_drop_at_least",   label: "One drop of ≥ G G$",            params: ["g"] },
  { value: "claimed_single_at_least",label: "One find of ≥ G G$",            params: ["g"] },
  { value: "claimed_drop_in",        label: "Claimed one of specific drops", params: ["dropIds"] },
  { value: "claimed_near",           label: "Claimed near a location",       params: ["geo"] },
  { value: "campaign_claims",        label: "Claims in a campaign",          params: ["campaign", "n"] },
  { value: "streak_at_least",        label: "Streak ≥ N days",               params: ["n"] },
  { value: "fast_claim_within",      label: "Claimed within S seconds",      params: ["seconds"] },
];

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "#fff",
  border: "2px solid #111", borderRadius: 10, fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", outline: "none",
};

export default function AdminBadgesPage() {
  const [builtins, setBuiltins] = useState<BadgeDef[]>([]);
  const [customs, setCustoms]   = useState<BadgeDef[]>([]);
  const [sets, setSets]         = useState<BadgeSetDef[]>([]);
  const [holders, setHolders]   = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [ok, setOk]             = useState("");

  // Create-badge form
  const [bId, setBId] = useState(""); const [bName, setBName] = useState("");
  const [bEmoji, setBEmoji] = useState("🏅"); const [bDesc, setBDesc] = useState("");
  const [ruleType, setRuleType] = useState<RuleType>("claims_at_least");
  const [pN, setPN] = useState("5"); const [pG, setPG] = useState("100");
  const [pDropIds, setPDropIds] = useState(""); const [pLat, setPLat] = useState("");
  const [pLng, setPLng] = useState(""); const [pRadius, setPRadius] = useState("300");
  const [pCampaign, setPCampaign] = useState(""); const [pSeconds, setPSeconds] = useState("300");
  // Create-set form
  const [sId, setSId] = useState(""); const [sName, setSName] = useState("");
  const [sEmoji, setSEmoji] = useState("🏆"); const [sDesc, setSDesc] = useState("");
  const [sBadges, setSBadges] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/badges/admin");
      if (res.status === 403) { setErr("Not authorised."); return; }
      const d = await res.json();
      setBuiltins(d.builtins ?? []); setCustoms(d.customs ?? []);
      setSets(d.sets ?? []); setHolders(d.holders ?? {});
    } catch { setErr("Couldn't load badges."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function buildRule(): BadgeRule | null {
    const n = parseInt(pN, 10); const g = parseFloat(pG);
    switch (ruleType) {
      case "claims_at_least": case "drops_at_least": case "streak_at_least":
        return Number.isFinite(n) && n >= 1 ? { type: ruleType, n } : null;
      case "gd_claimed_at_least": case "single_drop_at_least": case "claimed_single_at_least":
        return Number.isFinite(g) && g >= 1 ? { type: ruleType, g } : null;
      case "fast_claim_within": {
        const s = parseInt(pSeconds, 10);
        return Number.isFinite(s) && s >= 10 ? { type: ruleType, seconds: s } : null;
      }
      case "claimed_drop_in": {
        const ids = pDropIds.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        return ids.length ? { type: ruleType, dropIds: ids } : null;
      }
      case "claimed_near": {
        const lat = parseFloat(pLat), lng = parseFloat(pLng), radiusM = parseFloat(pRadius);
        return Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusM)
          ? { type: ruleType, lat, lng, radiusM } : null;
      }
      case "campaign_claims":
        return pCampaign.trim() && Number.isFinite(n) && n >= 1
          ? { type: ruleType, campaignId: pCampaign.trim(), n } : null;
      default: return null;
    }
  }

  async function post(body: unknown): Promise<boolean> {
    setBusy(true); setErr(""); setOk("");
    try {
      const res = await fetch("/api/badges/admin", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Failed"); return false; }
      await load();
      return true;
    } catch { setErr("Network error"); return false; }
    finally { setBusy(false); }
  }

  async function createBadge() {
    const rule = buildRule();
    if (!rule) { setErr("Fill in the rule parameters."); return; }
    const done = await post({ op: "badge:upsert", badge: { id: bId.trim(), name: bName, emoji: bEmoji, description: bDesc, rule } });
    if (done) { setOk(`Badge "${bName}" saved.`); setBId(""); setBName(""); setBDesc(""); }
  }

  async function createSet() {
    const done = await post({ op: "set:upsert", set: { id: sId.trim(), name: sName, emoji: sEmoji, description: sDesc, badgeIds: [...sBadges] } });
    if (done) { setOk(`Set "${sName}" saved.`); setSId(""); setSName(""); setSDesc(""); setSBadges(new Set()); }
  }

  const params = RULE_OPTIONS.find((r) => r.value === ruleType)?.params ?? [];
  const allBadges = [...builtins, ...customs];

  const chip = (b: BadgeDef, custom: boolean) => (
    <div key={b.id} style={{ background: "#fff", border: "2px solid #111", borderRadius: 12, padding: "10px 12px", boxShadow: "2px 2px 0 #111" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{b.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 13.5 }}>{b.name} <span style={{ color: "#999", fontWeight: 600, fontSize: 11 }}>· {holders[b.id] ?? 0} holders</span></p>
          <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "#777" }}>{b.description}</p>
        </div>
        {custom ? (
          <button onClick={() => post({ op: "badge:delete", id: b.id }).then((d) => d && setOk(`Deleted ${b.name}.`))} disabled={busy}
            style={{ border: "2px solid #C81E1E", color: "#C81E1E", background: "#fff", borderRadius: 8, padding: "4px 9px", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            Delete
          </button>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 800, color: "#aaa", textTransform: "uppercase" }}>built-in</span>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 16px 60px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Badges</h1>
        <p style={{ color: "#5a5a5a", fontSize: 13.5, margin: "4px 0 18px" }}>
          Status hunters earn from GPS-verified claims. Create event collections and venue badges here — they award automatically.
        </p>

        {err && <p style={{ color: "#C81E1E", fontWeight: 700, fontSize: 13, margin: "0 0 10px" }}>{err}</p>}
        {ok && <p style={{ color: "#3a7d00", fontWeight: 700, fontSize: 13, margin: "0 0 10px" }}>{ok}</p>}
        {loading ? <p style={{ color: "#888", fontWeight: 700 }}>Loading…</p> : (
          <>
            {/* Existing badges */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {customs.map((b) => chip(b, true))}
              {builtins.map((b) => chip(b, false))}
            </div>

            {/* Create badge */}
            <h2 style={{ fontSize: 16, fontWeight: 900, margin: "24px 0 10px" }}>Create a badge</h2>
            <div style={{ background: "#fff", border: "2px solid #111", borderRadius: 14, padding: 14, boxShadow: "3px 3px 0 #111", display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr", gap: 8 }}>
                <input value={bEmoji} onChange={(e) => setBEmoji(e.target.value)} placeholder="🏅" style={{ ...inputStyle, textAlign: "center" }} aria-label="Emoji" />
                <input value={bId} onChange={(e) => setBId(e.target.value.toLowerCase())} placeholder="id-slug (e.g. devconnect-1)" style={inputStyle} />
                <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Name" style={inputStyle} />
              </div>
              <input value={bDesc} onChange={(e) => setBDesc(e.target.value)} placeholder="Description (shown on the wall)" style={inputStyle} />
              <select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)} style={inputStyle}>
                {RULE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {params.includes("n") && <input value={pN} onChange={(e) => setPN(e.target.value)} placeholder="N" type="number" style={{ ...inputStyle, width: 110 }} />}
                {params.includes("g") && <input value={pG} onChange={(e) => setPG(e.target.value)} placeholder="G$" type="number" style={{ ...inputStyle, width: 110 }} />}
                {params.includes("seconds") && <input value={pSeconds} onChange={(e) => setPSeconds(e.target.value)} placeholder="Seconds" type="number" style={{ ...inputStyle, width: 130 }} />}
                {params.includes("dropIds") && <input value={pDropIds} onChange={(e) => setPDropIds(e.target.value)} placeholder="Drop ids, comma-separated" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />}
                {params.includes("geo") && (<>
                  <input value={pLat} onChange={(e) => setPLat(e.target.value)} placeholder="Lat" style={{ ...inputStyle, width: 120 }} />
                  <input value={pLng} onChange={(e) => setPLng(e.target.value)} placeholder="Lng" style={{ ...inputStyle, width: 120 }} />
                  <input value={pRadius} onChange={(e) => setPRadius(e.target.value)} placeholder="Radius m" type="number" style={{ ...inputStyle, width: 120 }} />
                </>)}
                {params.includes("campaign") && <input value={pCampaign} onChange={(e) => setPCampaign(e.target.value)} placeholder="Campaign id" style={{ ...inputStyle, width: 180 }} />}
              </div>
              <button onClick={createBadge} disabled={busy || !bId || !bName}
                style={{ height: 46, background: "#BFFD00", border: "2.5px solid #111", borderRadius: 12, fontWeight: 900, fontSize: 14, cursor: "pointer", fontFamily: "inherit", boxShadow: "3px 3px 0 #111" }}>
                {busy ? "Saving…" : "Create badge"}
              </button>
            </div>

            {/* Sets */}
            <h2 style={{ fontSize: 16, fontWeight: 900, margin: "24px 0 10px" }}>Collections (sets)</h2>
            {sets.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                {sets.map((s) => (
                  <div key={s.id} style={{ background: "#fff", border: "2px solid #111", borderRadius: 12, padding: "10px 12px", boxShadow: "2px 2px 0 #111", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{s.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 13.5 }}>{s.name}</p>
                      <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "#777" }}>{s.badgeIds.length} badges: {s.badgeIds.join(", ")}</p>
                    </div>
                    <button onClick={() => post({ op: "set:delete", id: s.id }).then((d) => d && setOk(`Deleted set ${s.name}.`))} disabled={busy}
                      style={{ border: "2px solid #C81E1E", color: "#C81E1E", background: "#fff", borderRadius: 8, padding: "4px 9px", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ background: "#fff", border: "2px solid #111", borderRadius: 14, padding: 14, boxShadow: "3px 3px 0 #111", display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr", gap: 8 }}>
                <input value={sEmoji} onChange={(e) => setSEmoji(e.target.value)} placeholder="🏆" style={{ ...inputStyle, textAlign: "center" }} aria-label="Set emoji" />
                <input value={sId} onChange={(e) => setSId(e.target.value.toLowerCase())} placeholder="set-id (e.g. devconnect-2026)" style={inputStyle} />
                <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Set name" style={inputStyle} />
              </div>
              <input value={sDesc} onChange={(e) => setSDesc(e.target.value)} placeholder="Description" style={inputStyle} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {allBadges.map((b) => {
                  const on = sBadges.has(b.id);
                  return (
                    <button key={b.id} onClick={() => setSBadges((prev) => { const nx = new Set(prev); if (on) nx.delete(b.id); else nx.add(b.id); return nx; })}
                      style={{ padding: "6px 10px", borderRadius: 100, border: "2px solid #111", background: on ? "#111" : "#fff", color: on ? "#fff" : "#111", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                      {b.emoji} {b.name}
                    </button>
                  );
                })}
              </div>
              <button onClick={createSet} disabled={busy || !sId || !sName || sBadges.size < 2}
                style={{ height: 46, background: sBadges.size >= 2 ? "#BFFD00" : "#e8e7e2", border: "2.5px solid #111", borderRadius: 12, fontWeight: 900, fontSize: 14, cursor: "pointer", fontFamily: "inherit", boxShadow: sBadges.size >= 2 ? "3px 3px 0 #111" : "none" }}>
                {busy ? "Saving…" : `Create set (${sBadges.size} badges picked)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
