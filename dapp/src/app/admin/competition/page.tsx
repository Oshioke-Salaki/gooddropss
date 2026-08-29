"use client";
import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { isAdminAddress } from "@/lib/admins";
import { Loader2, Save, Send, ExternalLink } from "lucide-react";

interface Config {
  id: string; startsAt: number; endsAt: number; potWei: string;
  tiers?: number[]; minDropWei?: string; referralBonusWeight?: number;
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
  const [pot, setPot] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [tiers, setTiers] = useState("");
  const [minDrop, setMinDrop] = useState("");
  const [bonus, setBonus] = useState("");
  const [msg, setMsg] = useState("");
  const [refReferrer, setRefReferrer] = useState("");
  const [refInvitee, setRefInvitee] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [creditMsg, setCreditMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"" | "save">("");

  const loadConfig = useCallback(() => {
    fetch("/api/comp/config").then((r) => r.json()).then((c: Config) => {
      setCfg(c);
      setPot(String(Math.round(Number(c.potWei) / 1e18)));
      setStartsAt(toLocalInput(c.startsAt));
      setEndsAt(toLocalInput(c.endsAt));
      setTiers(Array.isArray(c.tiers) ? c.tiers.join(", ") : "");
      setMinDrop(c.minDropWei ? String(Math.round(Number(c.minDropWei) / 1e18)) : "");
      setBonus(String(c.referralBonusWeight ?? 1));
    }).catch(() => {});
  }, []);
  useEffect(() => { if (isAdmin) loadConfig(); }, [isAdmin, loadConfig]);

  async function save() {
    setBusy("save"); setMsg("");
    try {
      const res = await fetch("/api/comp/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pot: Number(pot),
          startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
          ...(tiers.trim() ? { tiers } : {}),
          ...(minDrop.trim() ? { minDrop: Number(minDrop) } : {}),
          ...(bonus.trim() ? { referralBonusWeight: Number(bonus) } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error ?? "Save failed"); return; }
      setMsg("Saved.");
      loadConfig();
    } catch { setMsg("Network error"); }
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

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      <h1 className="text-2xl font-black mb-1">The Big Drop — Competition</h1>
      <p className="text-sm text-gray-500 mb-5">Config is live the moment you save. Amounts are in whole G$. Winners are paid once at the end via <span className="font-mono">scripts/pay-tiered.mjs</span>.</p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-lime shadow-brutal-sm"><div className="text-xl font-black">{fmtG(potWei)}</div><div className="text-xs font-semibold">Pot G$</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{tierList.length}</div><div className="text-xs text-gray-500 font-semibold">Winners</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{minDrop || "0"}</div><div className="text-xs text-gray-500 font-semibold">Min drop G$</div></div>
      </div>

      {/* Config form */}
      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm space-y-3 mb-5">
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
        <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Referral bonus weight</span>
          <input className={`mt-1 ${inp}`} type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="1" />
          <span className="mt-1 block text-[11px] text-gray-500">Score = distinct verified people who claimed your drops (≥ min drop) + bonus × those you also referred. Only claimed drops count; both dropper and claimer must be verified.</span>
        </label>
        <button onClick={save} disabled={busy === "save"} className="btn-brutal flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-black text-sm bg-ink text-lime disabled:opacity-60">
          {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save config
        </button>
        {msg && <p className="text-sm font-bold">{msg}</p>}
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
