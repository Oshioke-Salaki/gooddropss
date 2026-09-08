"use client";
import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { isAdminAddress } from "@/lib/admins";
import { Loader2, Save, Send, ExternalLink } from "lucide-react";

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

export default function AdminCompetitionPage() {
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);

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
  useEffect(() => { if (isAdmin) loadConfig(); }, [isAdmin, loadConfig]);

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

  if (!isAdmin) {
    return <div className="p-8 text-center text-gray-500" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Admins only.</div>;
  }

  const potWei = cfg?.potWei ?? "0";
  const tierList = tiers.split(",").map((t) => Number(t.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const tierSum = tierList.reduce((s, n) => s + n, 0);
  const sumMismatch = tierList.length > 0 && Math.abs(tierSum - Math.round(Number(potWei) / 1e18)) > 0;
  const inp = "w-full border-2 border-ink rounded-lg px-3 py-2 text-sm outline-none";
  // How many referrals the referral pot can cover (floor — it never overspends).
  const refSlots = Number(rPer) > 0 ? Math.floor(Number(rPot) / Number(rPer)) : 0;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      <h1 className="text-2xl font-black mb-1">Competitions</h1>
      <p className="text-sm text-gray-500 mb-5">Two competitions run side by side, each with its own pot and leaderboard. Config is live the moment you save; amounts are in whole G$.</p>

      <h2 className="text-lg font-black mb-1">1 · Points competition</h2>
      <p className="text-xs text-gray-500 mb-3">Drop + claim + refer + downline. Top-N split the pot, paid at the end via <span className="font-mono">scripts/pay-tiered.mjs</span>.</p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-lime shadow-brutal-sm"><div className="text-xl font-black">{fmtG(potWei)}</div><div className="text-xs font-semibold">Pot G$</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{tierList.length}</div><div className="text-xs text-gray-500 font-semibold">Winners</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{minDrop || "0"}</div><div className="text-xs text-gray-500 font-semibold">Min drop G$</div></div>
      </div>

      {/* Config form */}
      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm space-y-3 mb-5">
        <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Season id</span>
          <input className={`mt-1 ${inp}`} type="text" value={id} onChange={(e) => setId(e.target.value)} placeholder="points-2026-09" />
          <span className="mt-1 block text-[11px] text-gray-500">Scopes this season&apos;s participant data. <b>Change it when starting a new competition</b> — otherwise the new season inherits the previous one&apos;s participants.</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Pot (G$)</span>
            <input className={`mt-1 ${inp}`} type="number" value={pot} onChange={(e) => setPot(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Min drop to count (G$)</span>
            <input className={`mt-1 ${inp}`} type="number" value={minDrop} onChange={(e) => setMinDrop(e.target.value)} placeholder="100" /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Starts</span>
            <input className={`mt-1 ${inp}`} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Ends</span>
            <input className={`mt-1 ${inp}`} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
        </div>
        <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Prize tiers — whole G$, rank 1 first (comma-separated)</span>
          <input className={`mt-1 ${inp}`} type="text" value={tiers} onChange={(e) => setTiers(e.target.value)} placeholder="250000, 150000, 100000, …" />
          <span className={`mt-1 block text-[11px] ${sumMismatch ? "text-orange-600 font-semibold" : "text-gray-500"}`}>
            {tierList.length} winners · tiers sum to {tierSum.toLocaleString()} G${sumMismatch ? ` — does not match the ${fmtG(potWei)} G$ pot` : " (matches pot)"}.
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Points per referral</span>
            <input className={`mt-1 ${inp}`} type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="1" /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Downline bonus (L1, L2)</span>
            <input className={`mt-1 ${inp}`} type="text" value={downline} onChange={(e) => setDownline(e.target.value)} placeholder="0.25, 0.1" /></label>
        </div>
        <span className="block text-[11px] text-gray-500">Score = people who claimed your drops (reach) + people whose drops you claimed (claim) + referral-weight × people you referred + downline bonus (a fraction of your referrals&apos; score, and their referrals&apos; score). Fractions 0–1, e.g. 0.25 = 25%. Every side must be verified; only drops ≥ min drop count.</span>
        <button onClick={save} disabled={busy === "save"} className="btn-brutal flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-black text-sm bg-ink text-lime disabled:opacity-60">
          {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save config
        </button>
        {msg && <p className="text-sm font-bold">{msg}</p>}
      </div>

      {/* ── Referral competition ─────────────────────────────────────────────── */}
      <h2 className="text-lg font-black mb-1">2 · Referral competition</h2>
      <p className="text-xs text-gray-500 mb-3">Flat rate per referral, unlocked at the threshold, first-come-first-served until the pot runs out. Paid at the end via <span className="font-mono">scripts/pay-referrals.mjs</span>.</p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-lime shadow-brutal-sm"><div className="text-xl font-black">{rPot ? Number(rPot).toLocaleString() : "—"}</div><div className="text-xs font-semibold">Pot G$</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{rPer ? Number(rPer).toLocaleString() : "—"}</div><div className="text-xs text-gray-500 font-semibold">Per referral</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{refSlots.toLocaleString()}</div><div className="text-xs text-gray-500 font-semibold">Paid slots</div></div>
      </div>

      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm space-y-3 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Pot (G$)</span>
            <input className={`mt-1 ${inp}`} type="number" value={rPot} onChange={(e) => setRPot(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Per referral (G$)</span>
            <input className={`mt-1 ${inp}`} type="number" value={rPer} onChange={(e) => setRPer(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Unlock threshold</span>
            <input className={`mt-1 ${inp}`} type="number" value={rThreshold} onChange={(e) => setRThreshold(e.target.value)} /></label>
          <div />
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Starts</span>
            <input className={`mt-1 ${inp}`} type="datetime-local" value={rStarts} onChange={(e) => setRStarts(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Ends</span>
            <input className={`mt-1 ${inp}`} type="datetime-local" value={rEnds} onChange={(e) => setREnds(e.target.value)} /></label>
        </div>
        <span className="block text-[11px] text-gray-500">
          Pot ÷ per-referral = <b>{refSlots.toLocaleString()}</b> paid referrals. A referrer earns nothing until they reach
          the threshold; after that every referral of theirs is covered in credit order until the slots run out.
          {refCfg ? <> Season id: <span className="font-mono">{refCfg.id}</span>.</> : null}
        </span>
        <button onClick={saveRef} disabled={busy === "saveRef"} className="btn-brutal flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-black text-sm bg-ink text-lime disabled:opacity-60">
          {busy === "saveRef" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save referral config
        </button>
        {rMsg && <p className="text-sm font-bold">{rMsg}</p>}
      </div>

      {/* Recover a referral — for links the automatic flow missed. Same anti-cheat
          rules as the live path, so it can't credit fakes. Feeds the referral bonus. */}
      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm space-y-3">
        <p className="text-xs font-black uppercase tracking-wide text-gray-500">Recover a referral</p>
        <p className="text-sm text-gray-600">Use @username or 0x address. The invitee must be a verified human who has claimed or created a drop, and not already referred by someone else. This restores the referral link so it can earn the double-count bonus.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Referrer (gets credit)</span>
            <input className={`mt-1 ${inp}`} placeholder="@samuel" value={refReferrer} onChange={(e) => setRefReferrer(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Invitee (was referred)</span>
            <input className={`mt-1 ${inp}`} placeholder="@rahimat" value={refInvitee} onChange={(e) => setRefInvitee(e.target.value)} /></label>
        </div>
        <button onClick={creditReferral} disabled={crediting || !refReferrer.trim() || !refInvitee.trim()}
          className="btn-brutal flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-black text-sm bg-ink text-lime disabled:opacity-60">
          {crediting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Credit referral
        </button>
        {creditMsg && <p className={`text-xs font-bold ${creditMsg.ok ? "text-green-700" : "text-red-600"}`}>{creditMsg.text}</p>}
      </div>

      <a href="/competition" target="_blank" rel="noopener noreferrer"
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-gray-600 hover:text-ink">
        View public leaderboard <ExternalLink size={13} />
      </a>
    </div>
  );
}
