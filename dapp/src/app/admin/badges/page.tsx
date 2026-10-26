"use client";
import { useState, useEffect, useCallback } from "react";
import { Medal, Trash2, Layers } from "lucide-react";
import type { BadgeDef, BadgeSetDef, BadgeRule } from "@/lib/badges";
import { badgeArt } from "@/components/profile/badgeArt";
import {
  AdminPage, Button, Card, ChoiceChip, EmptyState, Field, Hint, Input, RowsSkeleton, SectionTitle, Select, Tag,
} from "@/components/admin/ui";

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

/** The badge's picture: illustration when we have one, its stored glyph until then. */
function BadgeMark({ badge, size = 44 }: { badge: Pick<BadgeDef, "id" | "emoji">; size?: number }) {
  const art = badgeArt(badge.id);
  return (
    <span
      className="rounded-full bg-surface flex items-center justify-center shrink-0 overflow-hidden"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {art ? <img src={art} alt="" className="w-full h-full object-contain" /> : badge.emoji}
    </span>
  );
}

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

  const row = (b: BadgeDef, custom: boolean) => (
    <div key={b.id} className="flex items-center gap-3 border border-line rounded-full p-2 pr-3 lg:pr-4 min-w-0">
      <BadgeMark badge={b} />
      <div className="flex-1 min-w-0">
        <p className="text-base/none text-heading truncate">
          {b.name} <span className="text-sm text-nav-muted">· {holders[b.id] ?? 0} holders</span>
        </p>
        <p className="text-sm/none text-nav-muted mt-1.5 truncate">{b.description}</p>
      </div>
      {custom ? (
        <Button
          size="sm" variant="danger" disabled={busy}
          onClick={() => post({ op: "badge:delete", id: b.id }).then((d) => d && setOk(`Deleted ${b.name}.`))}
          aria-label={`Delete ${b.name}`}
        >
          <Trash2 className="w-4 h-4" strokeWidth={2} /> <span className="hidden sm:inline">Delete</span>
        </Button>
      ) : (
        <Tag>Built-in</Tag>
      )}
    </div>
  );

  return (
    <AdminPage
      title="Badges"
      subtitle="Status hunters earn from GPS-verified claims. Create event collections and venue badges here; they award automatically."
    >
      <Hint text={err || ok} tone={err ? "bad" : "ok"} className="mb-3" />

      {loading ? (
        <RowsSkeleton count={6} height="h-16" />
      ) : (
        <>
          {/* Existing badges */}
          <Card>
            <SectionTitle className="mb-5">All badges</SectionTitle>
            {allBadges.length === 0 ? (
              <EmptyState icon={Medal} title="No badges yet" />
            ) : (
              <div className="flex flex-col gap-2">
                {customs.map((b) => row(b, true))}
                {builtins.map((b) => row(b, false))}
              </div>
            )}
          </Card>

          {/* Create badge */}
          <Card className="mt-6">
            <SectionTitle className="mb-5">Create a badge</SectionTitle>
            <div className="grid grid-cols-[88px_1fr] lg:grid-cols-[88px_1fr_1fr] gap-3">
              <Field label="Glyph">
                <Input value={bEmoji} onChange={(e) => setBEmoji(e.target.value)} className="text-center" aria-label="Badge glyph" />
              </Field>
              <Field label="Id">
                <Input value={bId} onChange={(e) => setBId(e.target.value.toLowerCase())} placeholder="devconnect-1" spellCheck={false} />
              </Field>
              <Field label="Name">
                <Input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Name" />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Description"><Input value={bDesc} onChange={(e) => setBDesc(e.target.value)} placeholder="Shown on the badge wall" /></Field>
            </div>
            <div className="mt-4">
              <Field label="Rule">
                <Select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
                  {RULE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
              </Field>
            </div>
            <div className="flex gap-3 flex-wrap mt-4">
              {params.includes("n") && <Input value={pN} onChange={(e) => setPN(e.target.value)} placeholder="N" type="number" className="w-32!" aria-label="N" />}
              {params.includes("g") && <Input value={pG} onChange={(e) => setPG(e.target.value)} placeholder="G$" type="number" className="w-32!" aria-label="G$" />}
              {params.includes("seconds") && <Input value={pSeconds} onChange={(e) => setPSeconds(e.target.value)} placeholder="Seconds" type="number" className="w-36!" aria-label="Seconds" />}
              {params.includes("dropIds") && <Input value={pDropIds} onChange={(e) => setPDropIds(e.target.value)} placeholder="Drop ids, comma-separated" className="flex-1 w-auto! min-w-[200px]" aria-label="Drop ids" />}
              {params.includes("geo") && (<>
                <Input value={pLat} onChange={(e) => setPLat(e.target.value)} placeholder="Lat" className="w-32!" aria-label="Latitude" />
                <Input value={pLng} onChange={(e) => setPLng(e.target.value)} placeholder="Lng" className="w-32!" aria-label="Longitude" />
                <Input value={pRadius} onChange={(e) => setPRadius(e.target.value)} placeholder="Radius m" type="number" className="w-32!" aria-label="Radius in metres" />
              </>)}
              {params.includes("campaign") && <Input value={pCampaign} onChange={(e) => setPCampaign(e.target.value)} placeholder="Campaign id" className="w-48!" aria-label="Campaign id" />}
            </div>
            <Button variant="primary" size="lg" className="mt-6" onClick={createBadge} busy={busy} disabled={!bId || !bName}>
              {busy ? "Saving…" : "Create badge"}
            </Button>
          </Card>

          {/* Sets */}
          <Card className="mt-6">
            <SectionTitle className="mb-5">Collections</SectionTitle>
            {sets.length > 0 ? (
              <div className="flex flex-col gap-2 mb-6">
                {sets.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 border border-line rounded-full p-2 pr-3 lg:pr-4 min-w-0">
                    <BadgeMark badge={s} />
                    <div className="flex-1 min-w-0">
                      <p className="text-base/none text-heading truncate">{s.name}</p>
                      <p className="text-sm/none text-nav-muted mt-1.5 truncate">{s.badgeIds.length} badges: {s.badgeIds.join(", ")}</p>
                    </div>
                    <Button
                      size="sm" variant="danger" disabled={busy}
                      onClick={() => post({ op: "set:delete", id: s.id }).then((d) => d && setOk(`Deleted set ${s.name}.`))}
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={2} /> <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm/[140%] text-nav-muted mb-6 flex items-center gap-2">
                <Layers className="w-4 h-4" strokeWidth={2} /> No collections yet. Group two or more badges below.
              </p>
            )}

            <div className="grid grid-cols-[88px_1fr] lg:grid-cols-[88px_1fr_1fr] gap-3">
              <Field label="Glyph">
                <Input value={sEmoji} onChange={(e) => setSEmoji(e.target.value)} className="text-center" aria-label="Set glyph" />
              </Field>
              <Field label="Id">
                <Input value={sId} onChange={(e) => setSId(e.target.value.toLowerCase())} placeholder="devconnect-2026" spellCheck={false} />
              </Field>
              <Field label="Name">
                <Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Set name" />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Description"><Input value={sDesc} onChange={(e) => setSDesc(e.target.value)} placeholder="Description" /></Field>
            </div>
            <p className="text-sm/none text-nav-muted mt-5 mb-3 px-1">Badges in this set</p>
            <div className="flex flex-wrap gap-2">
              {allBadges.map((b) => {
                const on = sBadges.has(b.id);
                return (
                  <ChoiceChip
                    key={b.id} on={on}
                    onClick={() => setSBadges((prev) => { const nx = new Set(prev); if (on) nx.delete(b.id); else nx.add(b.id); return nx; })}
                  >
                    <BadgeMark badge={b} size={20} /> {b.name}
                  </ChoiceChip>
                );
              })}
            </div>
            <Button variant="primary" size="lg" className="mt-6" onClick={createSet} busy={busy} disabled={!sId || !sName || sBadges.size < 2}>
              {busy ? "Saving…" : `Create set (${sBadges.size} picked)`}
            </Button>
          </Card>
        </>
      )}
    </AdminPage>
  );
}
