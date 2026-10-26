"use client";
import { useEffect, useState, useCallback } from "react";
import { Save, Send, ExternalLink } from "lucide-react";
import { AdminPage, Button, Card, Field, Hint, Input, SectionTitle, Stat } from "./ui";

interface Config {
  id: string; startsAt: number; endsAt: number; potWei: string;
  tiers?: number[]; minDropWei?: string; referralBonusWeight?: number; downlineWeights?: number[];
}
interface RefConfig {
  id: string; startsAt: number; endsAt: number; potWei: string;
  perReferralWei: string; threshold: number;
}

const toLocalInput = (unix: number) => {
  const dt = new Date(unix * 1000);
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fmtG = (wei: string) => Math.round(Number(wei) / 1e18).toLocaleString();

/** Admin · Competition — the points season and the referral season, side by side. */
export function CompetitionBody() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [id, setId] = useState("");
  const [pot, setPot] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [tiers, setTiers] = useState("");
  const [minDrop, setMinDrop] = useState("");
  const [bonus, setBonus] = useState("");
  const [downline, setDownline] = useState("");
  const [msg, setMsg] = useState("");
  const [refReferrer, setRefReferrer] = useState("");
  const [refInvitee, setRefInvitee] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [creditMsg, setCreditMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "saveRef">("");
  // Referral competition (runs alongside the points one, fully independent config).
  const [refCfg, setRefCfg] = useState<RefConfig | null>(null);
  const [rPot, setRPot] = useState("");
  const [rPer, setRPer] = useState("");
  const [rThreshold, setRThreshold] = useState("");
  const [rStarts, setRStarts] = useState("");
  const [rEnds, setREnds] = useState("");
  const [rMsg, setRMsg] = useState("");

  const loadConfig = useCallback(() => {
    fetch("/api/comp/referrals/config").then((r) => r.json()).then((c: RefConfig) => {
      if (!c?.potWei) return;
      setRefCfg(c);
      setRPot(String(Math.round(Number(c.potWei) / 1e18)));
      setRPer(String(Math.round(Number(c.perReferralWei) / 1e18)));
      setRThreshold(String(c.threshold));
      setRStarts(toLocalInput(c.startsAt));
      setREnds(toLocalInput(c.endsAt));
    }).catch(() => {});
    fetch("/api/comp/config").then((r) => r.json()).then((c: Config) => {
      setCfg(c);
      setId(c.id ?? "");
      setPot(String(Math.round(Number(c.potWei) / 1e18)));
      setStartsAt(toLocalInput(c.startsAt));
      setEndsAt(toLocalInput(c.endsAt));
      setTiers(Array.isArray(c.tiers) ? c.tiers.join(", ") : "");
      setMinDrop(c.minDropWei ? String(Math.round(Number(c.minDropWei) / 1e18)) : "");
      setBonus(String(c.referralBonusWeight ?? 1));
      setDownline(Array.isArray(c.downlineWeights) ? c.downlineWeights.join(", ") : "");
    }).catch(() => {});
  }, []);
  useEffect(() => { loadConfig(); }, [loadConfig]);

  async function save() {
    setBusy("save"); setMsg("");
    try {
      const res = await fetch("/api/comp/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(id.trim() ? { id: id.trim() } : {}),
          pot: Number(pot),
          startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
          ...(tiers.trim() ? { tiers } : {}),
          ...(minDrop.trim() ? { minDrop: Number(minDrop) } : {}),
          ...(bonus.trim() ? { referralBonusWeight: Number(bonus) } : {}),
          ...(downline.trim() ? { downlineWeights: downline } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error ?? "Save failed"); return; }
      setMsg("Saved.");
      loadConfig();
    } catch { setMsg("Network error"); }
    finally { setBusy(""); }
  }

  async function saveRef() {
    setBusy("saveRef"); setRMsg("");
    try {
      const res = await fetch("/api/comp/referrals/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pot: Number(rPot), perReferral: Number(rPer), threshold: Number(rThreshold),
          startsAt: new Date(rStarts).toISOString(), endsAt: new Date(rEnds).toISOString(),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setRMsg(d.error ?? "Save failed"); return; }
      setRMsg("Saved.");
      loadConfig();
    } catch { setRMsg("Network error"); }
    finally { setBusy(""); }
  }

  async function creditReferral() {
    if (crediting || !refReferrer.trim() || !refInvitee.trim()) return;
    setCrediting(true); setCreditMsg(null);
    try {
      const res = await fetch("/api/comp/credit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrer: refReferrer.trim(), invitee: refInvitee.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setCreditMsg({ ok: false, text: d.error ?? "Couldn't credit that referral." }); return; }
      setCreditMsg({ ok: true, text: d.message ?? "Credited." });
      setRefInvitee("");
      loadConfig();
    } catch { setCreditMsg({ ok: false, text: "Network error." }); }
    finally { setCrediting(false); }
  }

  const potWei = cfg?.potWei ?? "0";
  const tierList = tiers.split(",").map((t) => Number(t.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const tierSum = tierList.reduce((s, n) => s + n, 0);
  const sumMismatch = tierList.length > 0 && Math.abs(tierSum - Math.round(Number(potWei) / 1e18)) > 0;
  // How many referrals the referral pot can cover (floor — it never overspends).
  const refSlots = Number(rPer) > 0 ? Math.floor(Number(rPot) / Number(rPer)) : 0;
  const loading = cfg === null;

  return (
    <AdminPage
      title="Competitions"
      subtitle="Two competitions run side by side, each with its own pot and leaderboard. Config is live the moment you save; amounts are in whole G$."
      actions={
        <a
          href="/competition" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-white border border-line text-sm/none text-heading
            whitespace-nowrap motion-safe:transition-colors hover:bg-surface"
        >
          Public board <ExternalLink className="w-4 h-4" strokeWidth={2} />
        </a>
      }
    >
      {/* ── Points competition ───────────────────────────────────────────── */}
      <SectionTitle>Points competition</SectionTitle>
      <p className="text-sm/[140%] text-nav-muted mt-2 mb-4">
        Drop + claim + refer + downline. Top-N split the pot, paid at the end via <code className="text-heading">scripts/pay-tiered.mjs</code>.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat tone="accent" loading={loading} value={fmtG(potWei)} label="Pot G$" />
        <Stat loading={loading} value={String(tierList.length)} label="Winners" />
        <Stat loading={loading} value={minDrop || "0"} label="Min drop G$" />
      </div>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field
            label="Season id"
            hint={<>Scopes this season&apos;s participant data. <span className="text-heading">Change it when starting a new competition</span>, otherwise the new season inherits the previous one&apos;s participants.</>}
          >
            <Input type="text" value={id} onChange={(e) => setId(e.target.value)} placeholder="points-2026-09" spellCheck={false} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Pot (G$)"><Input type="number" value={pot} onChange={(e) => setPot(e.target.value)} /></Field>
            <Field label="Min drop to count (G$)"><Input type="number" value={minDrop} onChange={(e) => setMinDrop(e.target.value)} placeholder="100" /></Field>
            <Field label="Starts"><Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
            <Field label="Ends"><Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
          </div>
          <Field
            label="Prize tiers, whole G$, rank 1 first (comma-separated)"
            hint={
              <span className={sumMismatch ? "text-streak" : undefined}>
                {tierList.length} winners · tiers sum to {tierSum.toLocaleString()} G$
                {sumMismatch ? ` — does not match the ${fmtG(potWei)} G$ pot` : " (matches pot)"}.
              </span>
            }
          >
            <Input type="text" value={tiers} onChange={(e) => setTiers(e.target.value)} placeholder="250000, 150000, 100000, …" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Points per referral"><Input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="1" /></Field>
            <Field label="Downline bonus (L1, L2)"><Input type="text" value={downline} onChange={(e) => setDownline(e.target.value)} placeholder="0.25, 0.1" /></Field>
          </div>
          <p className="text-xs/[150%] text-nav-muted px-1">
            Score = people who claimed your drops (reach) + people whose drops you claimed (claim) + referral-weight × people you
            referred + downline bonus (a fraction of your referrals&apos; score, and their referrals&apos; score). Fractions 0–1,
            e.g. 0.25 = 25%. Every side must be verified; only drops ≥ min drop count.
          </p>
          <Button type="submit" variant="primary" size="lg" busy={busy === "save"}>
            {busy !== "save" && <Save className="w-4 h-4" strokeWidth={2} />} Save config
          </Button>
          <Hint text={msg} tone={msg === "Saved." ? "ok" : "bad"} className="px-1" />
        </form>
      </Card>

      {/* ── Referral competition ─────────────────────────────────────────── */}
      <SectionTitle className="mt-10">Referral competition</SectionTitle>
      <p className="text-sm/[140%] text-nav-muted mt-2 mb-4">
        Flat rate per referral, unlocked at the threshold, first-come-first-served until the pot runs out. Paid at the end via <code className="text-heading">scripts/pay-referrals.mjs</code>.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat tone="accent" loading={loading} value={rPot ? Number(rPot).toLocaleString() : "—"} label="Pot G$" />
        <Stat loading={loading} value={rPer ? Number(rPer).toLocaleString() : "—"} label="Per referral" />
        <Stat loading={loading} value={refSlots.toLocaleString()} label="Paid slots" />
      </div>

      <Card>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveRef(); }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Pot (G$)"><Input type="number" value={rPot} onChange={(e) => setRPot(e.target.value)} /></Field>
            <Field label="Per referral (G$)"><Input type="number" value={rPer} onChange={(e) => setRPer(e.target.value)} /></Field>
            <Field label="Unlock threshold"><Input type="number" value={rThreshold} onChange={(e) => setRThreshold(e.target.value)} /></Field>
            <div className="hidden sm:block" />
            <Field label="Starts"><Input type="datetime-local" value={rStarts} onChange={(e) => setRStarts(e.target.value)} /></Field>
            <Field label="Ends"><Input type="datetime-local" value={rEnds} onChange={(e) => setREnds(e.target.value)} /></Field>
          </div>
          <p className="text-xs/[150%] text-nav-muted px-1">
            Pot ÷ per-referral = <span className="text-heading">{refSlots.toLocaleString()}</span> paid referrals. A referrer earns
            nothing until they reach the threshold; after that every referral of theirs is covered in credit order until the slots run out.
            {refCfg ? <> Season id: <code className="text-heading">{refCfg.id}</code>.</> : null}
          </p>
          <Button type="submit" variant="primary" size="lg" busy={busy === "saveRef"}>
            {busy !== "saveRef" && <Save className="w-4 h-4" strokeWidth={2} />} Save referral config
          </Button>
          <Hint text={rMsg} tone={rMsg === "Saved." ? "ok" : "bad"} className="px-1" />
        </form>
      </Card>

      {/* Recover a referral — for links the automatic flow missed. Same anti-cheat
          rules as the live path, so it can't credit fakes. Feeds the referral bonus. */}
      <SectionTitle className="mt-10">Recover a referral</SectionTitle>
      <p className="text-sm/[140%] text-nav-muted mt-2 mb-4">
        Use @username or 0x address. The invitee must be a verified human who has claimed or created a drop, and not already
        referred by someone else. This restores the referral link so it can earn the double-count bonus.
      </p>
      <Card>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); creditReferral(); }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Referrer (gets credit)"><Input placeholder="@samuel" value={refReferrer} onChange={(e) => setRefReferrer(e.target.value)} spellCheck={false} /></Field>
            <Field label="Invitee (was referred)"><Input placeholder="@rahimat" value={refInvitee} onChange={(e) => setRefInvitee(e.target.value)} spellCheck={false} /></Field>
          </div>
          <Button type="submit" variant="primary" size="lg" busy={crediting} disabled={!refReferrer.trim() || !refInvitee.trim()}>
            {!crediting && <Send className="w-4 h-4" strokeWidth={2} />} Credit referral
          </Button>
          <Hint text={creditMsg?.text} tone={creditMsg?.ok ? "ok" : "bad"} className="px-1" />
        </form>
      </Card>
    </AdminPage>
  );
}
