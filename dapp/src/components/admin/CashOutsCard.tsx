"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { formatNaira } from "@/lib/goodcash";
import { Button, Card, EmptyState, Hint, SectionTitle, Stat, Tag } from "./ui";

interface PaidRow { id: string; wallet: string; amountG: string; naira: number; nairaPerDollar: number; txHash: string | null; paidAt: string }
interface Health { mode: "live" | "test"; partnerName: string | null; partnerFeePercent: number | null; webhookUrl: string | null; webhookReady: boolean }
interface Data { configured: boolean; mode?: "live" | "test"; count?: number; g?: number; naira?: number; people?: number; recent?: PaidRow[]; health?: Health; error?: string }

const g = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * The central cash-out figure: every G$ our users have cashed out to a bank, and
 * its naira value at the time of each cash out. Counted only when GoodCash
 * confirms the bank was paid, once per cash out.
 */
export function CashOutsCard() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [hookMsg, setHookMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const load = () => fetch("/api/admin/cashouts")
    .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then(setData)
    .catch(() => setErr("Couldn't load cash outs. Refresh to try again."));
  useEffect(() => { void load(); }, []);

  const connect = async () => {
    setConnecting(true); setHookMsg(null);
    try {
      const r = await fetch("/api/admin/cashouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect-webhook" }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        // Show it as connected now; GoodCash can take a moment to report it back.
        setData((cur) => (cur?.health ? { ...cur, health: { ...cur.health, webhookReady: true, webhookUrl: d.url ?? cur.health.webhookUrl } } : cur));
        setHookMsg({ text: "Connected. GoodCash will now tell us the moment each bank is paid.", tone: "ok" });
      } else {
        setHookMsg({ text: d.error ?? "Couldn't connect. Try again.", tone: "bad" });
        await load();
      }
    } finally { setConnecting(false); }
  };
  const h = data?.health;

  const loading = !data && !err;
  return (
    <Card className="mb-6">
      <p className="text-sm/[145%] text-nav-muted mb-5">
        Valued in naira at the moment of each cash out. Counted once GoodCash confirms the bank was paid.
      </p>
      <Hint text={err} tone="bad" className="mb-3" />

      {data && !data.configured ? (
        <EmptyState icon={Landmark} title="Cash out isn't switched on" body="GOODCASH_SECRET_KEY must be a GoodCash secret key (it starts with gc_sk_live_). A publishable key (gc_pk_) won't work here." />
      ) : (
        <>
          {h && (
            <div className="rounded-2xl border border-line p-4 mb-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm/none text-heading">
                  <Tag tone={h.mode === "live" ? "good" : "warn"}>{h.mode === "live" ? "Live" : "Test mode"}</Tag>
                  {h.partnerName && <span className="text-nav-muted">GoodCash partner: {h.partnerName}</span>}
                </div>
                {h.webhookReady ? (
                  <Tag tone="good">Webhook connected</Tag>
                ) : (
                  <Button variant="primary" busy={connecting} onClick={connect}>{connecting ? "Connecting…" : "Connect webhook"}</Button>
                )}
              </div>
              {!h.webhookReady && !hookMsg && (
                <p className="text-sm/[145%] text-nav-muted">Connect the webhook so cash outs are confirmed the moment the bank is paid. Our server uses its own key; no secret is shown to anyone.</p>
              )}
              {hookMsg && <Hint text={hookMsg.text} tone={hookMsg.tone} />}
              {h.partnerFeePercent !== null && h.partnerFeePercent > 0 && (
                <Hint tone="bad" text={`GoodCash is still adding a ${h.partnerFeePercent}% partner fee. We already take our 1% ourselves, so ask GoodCash to set it to 0% or users pay twice.`} />
              )}
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat tone="accent" loading={loading} value={`${g(data?.g ?? 0)} G$`} label="Total cashed out" />
            <Stat loading={loading} value={formatNaira(data?.naira ?? 0)} label="Naira paid out" />
            <Stat loading={loading} value={g(data?.count ?? 0)} label="Cash outs" />
            <Stat loading={loading} value={g(data?.people ?? 0)} label="People" />
          </div>

          {data && (data.recent?.length ?? 0) === 0 ? (
            <p className="text-sm/[145%] text-nav-muted text-center py-6">No cash outs yet. They&apos;ll show here as soon as the first bank is paid.</p>
          ) : data ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm/[140%] min-w-[520px]">
                <thead>
                  <tr className="text-left text-nav-muted">
                    <th className="font-normal py-2 px-1">When</th>
                    <th className="font-normal py-2 px-1">Wallet</th>
                    <th className="font-normal py-2 px-1 text-right">G$</th>
                    <th className="font-normal py-2 px-1 text-right">Naira</th>
                    <th className="font-normal py-2 px-1 text-right">Rate ($1)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.recent!.map((r) => (
                    <tr key={r.id} className="text-heading">
                      <td className="py-2.5 px-1 whitespace-nowrap">{new Date(r.paidAt).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="py-2.5 px-1">
                        {r.txHash
                          ? <a className="text-brand hover:underline" href={`https://celoscan.io/tx/${r.txHash}`} target="_blank" rel="noopener noreferrer">{r.wallet.slice(0, 6)}…{r.wallet.slice(-4)}</a>
                          : `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`}
                      </td>
                      <td className="py-2.5 px-1 text-right">{g(Number(r.amountG))}</td>
                      <td className="py-2.5 px-1 text-right">{formatNaira(r.naira)}</td>
                      <td className="py-2.5 px-1 text-right text-nav-muted">{r.nairaPerDollar ? formatNaira(r.nairaPerDollar) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** The headline figures for the Analytics page; the full view is /admin/cashouts. */
export function CashOutsSummary() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/admin/cashouts")
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  if (failed || (data && !data.configured)) return null;
  const loading = !data;
  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <SectionTitle>Cash outs to bank</SectionTitle>
        <Link href="/admin/cashouts" className="inline-flex items-center gap-1 text-sm/none text-brand hover:underline">
          See all <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat tone="accent" loading={loading} value={`${g(data?.g ?? 0)} G$`} label="Total cashed out" />
        <Stat loading={loading} value={formatNaira(data?.naira ?? 0)} label="Naira paid out" />
        <Stat loading={loading} value={g(data?.count ?? 0)} label="Cash outs" sub={data ? `${g(data.people ?? 0)} ${data.people === 1 ? "person" : "people"}` : undefined} />
      </div>
    </Card>
  );
}
