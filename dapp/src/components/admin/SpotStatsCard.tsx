"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw, Store } from "lucide-react";
import { Button, Card, EmptyState, Hint, SectionTitle, Stat, Tag, timeAgo } from "./ui";
import type { SpotStats, SpotRow } from "@/lib/spotStats";

type Data = SpotStats & { rewardsOk?: boolean; error?: string };
type SortKey = "circulated" | "paid" | "payments" | "visitors" | "rewards" | "newest";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "circulated", label: "G$ circulated" },
  { key: "paid", label: "G$ paid in" },
  { key: "payments", label: "Payments" },
  { key: "visitors", label: "People" },
  { key: "rewards", label: "Rewards claimed" },
  { key: "newest", label: "Newest" },
];

const g = (wei: string | bigint) => {
  const n = Number(BigInt(wei)) / 1e18;
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
};
const n = (x: number) => x.toLocaleString("en-US");
const big = (wei: string) => BigInt(wei || "0");
const pl = (x: number, one: string, many = one + "s") => `${n(x)} ${x === 1 ? one : many}`;

function cmp(a: SpotRow, b: SpotRow, key: SortKey): number {
  const d = (x: bigint, y: bigint) => (x === y ? 0 : y > x ? 1 : -1);
  switch (key) {
    case "circulated": return d(big(a.circulatedWei), big(b.circulatedWei));
    case "paid": return d(big(a.paidWei), big(b.paidWei));
    case "payments": return b.payments - a.payments;
    case "visitors": return b.visitors - a.visitors;
    case "rewards": return b.rewardsClaimed - a.rewardsClaimed;
    case "newest": return b.createdAt - a.createdAt;
  }
}

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "muted"> = {
  active: "good", pending: "warn", paused: "muted", suspended: "bad", rejected: "bad",
};

/**
 * GoodSpots numbers for the admin: how many businesses there are, how much G$
 * each one has taken in, its reward drops, and how many people came to it.
 * Every figure is a verified one (payments read from the chain, rewards from
 * the indexer, visits from in-store QR approvals).
 */
export function SpotStatsCard() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortKey>("circulated");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setErr("");
    fetch("/api/admin/spots", { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setErr("Couldn't load GoodSpots numbers. Try refreshing."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data ? [...data.rows].sort((a, b) => cmp(a, b, sort)) : []), [data, sort]);
  const shown = showAll ? rows : rows.slice(0, 15);

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4 px-1">
        <div>
          <SectionTitle>GoodSpots numbers</SectionTitle>
          <p className="text-sm/[140%] text-nav-muted mt-2">
            Verified only: G$ paid to shops (read from the chain), shop reward drops, and in-store QR approvals.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} strokeWidth={2} /> Refresh
        </Button>
      </div>
      <Hint text={err} tone="bad" className="mb-3" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat tone="accent" fit loading={!data} value={data ? `${g(data.circulatedWei)} G$` : ""} label="G$ circulated at shops" sub="Paid in + rewards claimed" />
        <Stat loading={!data} value={data ? n(data.businesses) : ""} label="Businesses"
          sub={data ? `${data.byStatus.active} live · ${data.byStatus.pending} pending · ${data.byStatus.paused + data.byStatus.suspended} off` : undefined} />
        <Stat loading={!data} value={data ? n(data.visitors) : ""} label="People at shops" sub="Paid, had a reward approved, or claimed one" />
        <Stat loading={!data} value={data ? n(data.customers) : ""} label="Paying customers" sub="Distinct wallets that paid a shop" />
        <Stat fit loading={!data} value={data ? `${g(data.paidWei)} G$` : ""} label="G$ paid to shops" sub={data ? pl(data.payments, "payment") : undefined} />
        <Stat fit loading={!data} value={data ? `${g(data.paidWei30d)} G$` : ""} label="Paid, last 30 days" sub={data ? pl(data.payments30d, "payment") : undefined} />
        <Stat fit loading={!data} value={data ? `${g(data.rewardClaimedWei)} G$` : ""} label="Shop rewards claimed"
          sub={data ? `${n(data.rewardsClaimed)} of ${n(data.rewards)} claimed · ${n(data.rewardsLive)} live · ${n(data.rewardsExpired)} expired` : undefined} />
        <Stat loading={!data} value={data ? n(data.approvals) : ""} label="In-store QR approvals"
          sub={data ? `${n(data.activeWithPayments)} live shops have taken a payment` : undefined} />
      </div>

      {data && (data.rewardsOk === false || data.approvalLogFull || data.paymentListCapped) && (
        <p className="text-xs/[150%] text-nav-muted mt-3 px-1">
          {data.rewardsOk === false && "Reward figures are incomplete: the indexer didn't answer. Refresh to retry. "}
          {data.approvalLogFull && "QR approvals count the latest 1,000 only. "}
          {data.paymentListCapped && "Totals are all-time; distinct payers and 30-day figures use each shop's latest 500 payments."}
        </p>
      )}

      <Card className="mt-4 !p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 flex-wrap">
          <p className="text-base/none text-heading">Each business</p>
          <div className="flex gap-1.5 flex-wrap">
            {SORTS.map((s) => (
              <button key={s.key} type="button" onClick={() => setSort(s.key)}
                className={`rounded-full px-3 py-2 text-xs/none border cursor-pointer ${sort === s.key ? "bg-brand text-white border-brand" : "border-line text-heading hover:bg-surface"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {!data ? (
          <div className="px-5 pb-5"><div className="h-40 rounded-2xl bg-surface animate-pulse" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Store} title="No businesses yet" />
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_1fr_1fr_0.8fr_0.8fr_1fr_24px] gap-3 px-5 py-2.5 text-xs/none text-nav-muted border-y border-line bg-surface/60">
              <span>Business</span><span className="text-right">Circulated</span><span className="text-right">Paid in</span>
              <span className="text-right">Payments</span><span className="text-right">People</span><span className="text-right">Rewards claimed</span><span />
            </div>
            <ul>
              {shown.map((r, i) => {
                const isOpen = open === r.id;
                return (
                  <li key={r.id} className="border-b border-line last:border-b-0">
                    <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}
                      className="w-full text-left px-5 py-4 grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,2.2fr)_1fr_1fr_0.8fr_0.8fr_1fr_24px] gap-x-3 gap-y-2 items-center cursor-pointer hover:bg-surface/50">
                      <span className="min-w-0 flex items-center gap-3">
                        <span className="w-7 text-sm/none text-nav-muted tabular-nums shrink-0">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-sm/none text-heading truncate">{r.name}</span>
                            {r.status !== "active" && <Tag tone={STATUS_TONE[r.status] ?? "muted"}>{r.status}</Tag>}
                          </span>
                          <span className="block text-xs/none text-nav-muted mt-1.5 truncate">{r.category} · {r.place}</span>
                        </span>
                      </span>
                      <span className="text-right text-sm/none text-heading tabular-nums">{g(r.circulatedWei)} G$</span>
                      <span className="hidden lg:block text-right text-sm/none tabular-nums">{g(r.paidWei)} G$</span>
                      <span className="hidden lg:block text-right text-sm/none tabular-nums">{n(r.payments)}</span>
                      <span className="hidden lg:block text-right text-sm/none tabular-nums">{n(r.visitors)}</span>
                      <span className="hidden lg:block text-right text-sm/none tabular-nums">{n(r.rewardsClaimed)}<span className="text-nav-muted">/{n(r.rewards)}</span></span>
                      <ChevronDown className={`hidden lg:block w-4 h-4 text-nav-muted transition-transform ${isOpen ? "rotate-180" : ""}`} strokeWidth={2} />
                      <span className="lg:hidden col-span-2 text-xs/none text-nav-muted pl-10">
                        {pl(r.payments, "payment")} · {pl(r.visitors, "person", "people")} · {n(r.rewardsClaimed)}/{n(r.rewards)} rewards
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-5 lg:pl-15">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                          <Mini label="G$ paid in" value={`${g(r.paidWei)} G$`} sub={pl(r.payments, "payment")} />
                          <Mini label="Last 30 days" value={`${g(r.paidWei30d)} G$`} sub={pl(r.payments30d, "payment")} />
                          <Mini label="Paying customers" value={n(r.payers)} sub={r.lastPaymentAt ? `last paid ${timeAgo(r.lastPaymentAt)}` : "no payments yet"} />
                          <Mini label="People who came" value={n(r.visitors)} sub="paid, approved or claimed" />
                          <Mini label="Rewards created" value={n(r.rewards)} sub={`${g(r.rewardWei)} G$ · ${n(r.rewardsLive)} live · ${n(r.rewardsExpired)} expired`} />
                          <Mini label="Rewards claimed" value={n(r.rewardsClaimed)} sub={`${g(r.rewardClaimedWei)} G$ · ${pl(r.rewardClaimers, "person", "people")}`} />
                          <Mini label="QR approvals" value={n(r.approvals)} sub="at the till" />
                          <Mini label="Joined" value={r.createdAt ? timeAgo(r.createdAt) : "-"} sub={r.status} />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {rows.length > 15 && (
              <div className="px-5 py-4 border-t border-line">
                <Button variant="secondary" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${rows.length}`}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3.5 min-w-0">
      <p className="text-base/none text-heading truncate tabular-nums">{value}</p>
      <p className="text-xs/none text-nav-muted mt-2 truncate">{label}</p>
      {sub && <p className="text-xs/[140%] text-nav-muted/70 mt-1 truncate">{sub}</p>}
    </div>
  );
}
