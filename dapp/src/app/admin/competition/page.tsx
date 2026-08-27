"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { isAdminAddress } from "@/lib/admins";
import { Loader2, Save, Send, RefreshCw, ExternalLink } from "lucide-react";

interface Config { id: string; startsAt: number; endsAt: number; potWei: string; perReferralWei: string; threshold: number }
interface LogEntry { root: string; to?: string; wei: string; tx: string; at: string; status: string; username: string | null }
interface Status {
  balancesOk: boolean; outstandingWei: string; settleableWei: string; potRemainingWei: string;
  walletBalWei: string; gasWei: string; canSettle: boolean; lowGas: boolean;
}
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
interface PayoutResult {
  ok: boolean; reason?: string;
  paid: { root: string; wei: string; tx: string }[];
  outstanding: { root: string; wei: string; reason: string }[];
  errors: { root: string; stage: string; error: string }[];
  potWei: string; potSpentWei: string; walletBalWei: string; gasWei: string; lowGas: boolean;
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
  const [perReferral, setPerReferral] = useState("");
  const [threshold, setThreshold] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [spentWei, setSpentWei] = useState("0");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");
  const [refReferrer, setRefReferrer] = useState("");
  const [refInvitee, setRefInvitee] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [creditMsg, setCreditMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "pay">("");
  const [result, setResult] = useState<PayoutResult | null>(null);

  const loadConfig = useCallback(() => {
    fetch("/api/comp/config").then((r) => r.json()).then((c: Config) => {
      setCfg(c);
      setPot(String(Math.round(Number(c.potWei) / 1e18)));
      setPerReferral(String(Math.round(Number(c.perReferralWei) / 1e18)));
      setThreshold(String(c.threshold));
      setStartsAt(toLocalInput(c.startsAt));
      setEndsAt(toLocalInput(c.endsAt));
    }).catch(() => {});
    fetch("/api/comp/leaderboard").then((r) => r.json()).then((d) => setSpentWei(d.potSpentWei ?? "0")).catch(() => {});
    fetch("/api/comp/log").then((r) => r.json()).then((d) => setLog(Array.isArray(d.entries) ? d.entries : [])).catch(() => {});
    fetch("/api/comp/status").then((r) => r.json()).then((s) => setStatus(s?.error ? null : s)).catch(() => {});
  }, []);
  useEffect(() => { if (isAdmin) loadConfig(); }, [isAdmin, loadConfig]);

  async function save() {
    setBusy("save"); setMsg("");
    try {
      const res = await fetch("/api/comp/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pot: Number(pot), perReferral: Number(perReferral), threshold: Number(threshold),
          startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
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

  async function payNow() {
    setBusy("pay"); setMsg(""); setResult(null);
    try {
      const res = await fetch("/api/comp/payout", { method: "POST" });
      const d: PayoutResult = await res.json();
      if (!res.ok) { setMsg((d as { error?: string }).error ?? "Payout failed"); return; }
      setResult(d);
      if (d.reason) setMsg(`No-op: ${d.reason}`);
      loadConfig();
    } catch { setMsg("Network error"); }
    finally { setBusy(""); }
  }

  if (!isAdmin) {
    return <div className="p-8 text-center text-gray-500" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Admins only.</div>;
  }

  const potWei = cfg?.potWei ?? "0";
  const remainingWei = cfg ? String(BigInt(potWei) - BigInt(spentWei)) : "0";
  const inp = "w-full border-2 border-ink rounded-lg px-3 py-2 text-sm outline-none";

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      <h1 className="text-2xl font-black mb-1">Referral Competition</h1>
      <p className="text-sm text-gray-500 mb-5">Config is live the moment you save. Amounts are in whole G$.</p>

      {/* Pot summary */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{fmtG(potWei)}</div><div className="text-xs text-gray-500 font-semibold">Pot G$</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-white shadow-brutal-sm"><div className="text-xl font-black">{fmtG(spentWei)}</div><div className="text-xs text-gray-500 font-semibold">Paid out</div></div>
        <div className="border-2 border-ink rounded-xl p-3 text-center bg-lime shadow-brutal-sm"><div className="text-xl font-black">{fmtG(remainingWei)}</div><div className="text-xs font-semibold">Remaining</div></div>
      </div>

      {/* Config form */}
      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm space-y-3 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Pot (G$)</span>
            <input className={`mt-1 ${inp}`} type="number" value={pot} onChange={(e) => setPot(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Per referral (G$)</span>
            <input className={`mt-1 ${inp}`} type="number" value={perReferral} onChange={(e) => setPerReferral(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Unlock threshold</span>
            <input className={`mt-1 ${inp}`} type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
          <div />
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Starts</span>
            <input className={`mt-1 ${inp}`} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-black uppercase tracking-wide text-gray-500">Ends</span>
            <input className={`mt-1 ${inp}`} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
        </div>
        <button onClick={save} disabled={busy === "save"} className="btn-brutal flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-black text-sm bg-ink text-lime disabled:opacity-60">
          {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save config
        </button>
      </div>

      {/* Manual payout */}
      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm space-y-3">
        <p className="text-sm text-gray-600">Payouts run automatically as referrals land. Use this after topping up the reward wallet to settle everything outstanding (including any that previously failed) at once.</p>

        {/* Live balances / owed */}
        {status && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="border border-gray-200 rounded-lg py-2"><div className="font-black text-sm">{fmtG(status.settleableWei)}</div><div className="text-gray-500">Outstanding G$</div></div>
            <div className="border border-gray-200 rounded-lg py-2"><div className="font-black text-sm">{fmtG(status.walletBalWei)}</div><div className="text-gray-500">Wallet G$</div></div>
            <div className={`border rounded-lg py-2 ${status.lowGas ? "border-red-400" : "border-gray-200"}`}><div className="font-black text-sm">{(Number(status.gasWei) / 1e18).toFixed(3)}</div><div className="text-gray-500">CELO gas</div></div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={payNow}
            disabled={busy === "pay" || !status?.canSettle}
            className="btn-brutal flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl font-black text-sm bg-lime text-ink disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {busy === "pay" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Pay outstanding now
          </button>
          <button onClick={loadConfig} className="btn-brutal px-3 py-2.5 rounded-xl bg-white" aria-label="Refresh"><RefreshCw size={16} /></button>
        </div>

        {/* Why the button is disabled */}
        {status && !status.canSettle && (
          <p className="text-xs text-orange-600 font-semibold">
            {BigInt(status.settleableWei) === 0n
              ? "Nothing outstanding to settle right now."
              : status.lowGas
              ? "Low on CELO gas — top up the reward wallet with CELO before settling."
              : BigInt(status.walletBalWei) < BigInt(status.settleableWei)
              ? `Reward wallet holds ${fmtG(status.walletBalWei)} G$ — top up ${fmtG(String(BigInt(status.settleableWei) - BigInt(status.walletBalWei)))} more to settle the ${fmtG(status.settleableWei)} G$ outstanding.`
              : !status.balancesOk
              ? "Couldn't read the reward wallet balance — check RPC and refresh."
              : "Not ready."}
          </p>
        )}
        {status?.canSettle && <p className="text-xs text-green-700 font-semibold">Ready to settle {fmtG(status.settleableWei)} G$.</p>}
        {result && (
          <div className="text-xs space-y-1 border-t border-gray-200 pt-2">
            <p><b>{result.paid.length}</b> paid · <b>{result.outstanding.length}</b> outstanding · <b>{result.errors.length}</b> errors</p>
            <p className="text-gray-500">Reward wallet: {fmtG(result.walletBalWei)} G$ · {(Number(result.gasWei) / 1e18).toFixed(4)} CELO gas · Pot spent: {fmtG(result.potSpentWei)} G$</p>
            {result.lowGas && <p className="text-red-600 font-bold">Low on CELO gas — top up the reward wallet with CELO or transfers will start failing.</p>}
            {result.outstanding.length > 0 && <p className="text-orange-600">Outstanding (top up the wallet, then run again): {result.outstanding.map((o) => `${fmtG(o.wei)}`).join(", ")} G$</p>}
            {result.errors.length > 0 && <p className="text-red-600">Review: {result.errors.map((e) => `${e.stage}`).join(", ")}</p>}
          </div>
        )}
      </div>

      {msg && <p className="text-sm font-bold mt-3">{msg}</p>}

      {/* Recover a referral — for links the automatic flow missed (e.g. the Redis
          outage). Same anti-cheat rules as the live path, so it can't credit fakes. */}
      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm mt-5 space-y-3">
        <p className="text-xs font-black uppercase tracking-wide text-gray-500">Recover a referral</p>
        <p className="text-sm text-gray-600">Use @username or 0x address. The invitee must be a verified human who has claimed or created a drop, and not already referred by someone else.</p>
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

      {/* Payout log — audit trail, newest first */}
      <div className="border-2 border-ink rounded-2xl p-4 bg-white shadow-brutal-sm mt-5">
        <p className="text-xs font-black uppercase tracking-wide text-gray-500 mb-2">Payout log ({log.length})</p>
        {log.length === 0 ? (
          <p className="text-sm text-gray-400">No payouts yet.</p>
        ) : (
          <div className="space-y-1.5">
            {log.map((e) => (
              <div key={e.tx} className="flex items-center gap-2 text-xs border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-gray-400 shrink-0 w-28 tabular-nums">{new Date(e.at).toLocaleString()}</span>
                <Link href={`/hunter/${e.root}`} className="font-bold truncate flex-1 hover:underline">
                  {e.username ? `@${e.username}` : shortAddr(e.root)}
                </Link>
                <span className="font-black shrink-0">{fmtG(e.wei)} G$</span>
                <a href={`https://celoscan.io/tx/${e.tx}`} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 text-gray-500 hover:text-ink inline-flex items-center gap-1">
                  tx <ExternalLink size={11} />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
