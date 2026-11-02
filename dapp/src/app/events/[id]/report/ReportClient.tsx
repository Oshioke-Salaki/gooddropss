"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Printer, RefreshCw } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { UserHandle } from "@/components/UserHandle";
import { useProfiles } from "@/hooks/useProfile";
import { formatG$ } from "@/lib/utils";
import { CATEGORY_LABEL, type EventStatsJson, type GdEvent } from "@/lib/events";
import { formatRange, tzLabel } from "@/components/events/format";

interface Report {
  event: GdEvent;
  stats: EventStatsJson;
  interested: number;
  hours: { at: number; claims: number; g: number }[];
  hunters: { address: string; claims: number; wei: string }[];
  unclaimedWei: string;
  reclaimedWei: string;
}

const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] print:shadow-none print:border print:border-line";
const G = 10n ** 18n;
const whole = (wei: string | bigint) => Number(BigInt(wei || "0") / G);

/**
 * The after-event report: what a host hands a sponsor or a campus. Every
 * number comes from the chain. Prints cleanly to PDF from the browser.
 */
export default function ReportClient({ id }: { id: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [copied, setCopied] = useState(false);

  async function load() {
    setState((s) => (s === "ok" ? s : "loading"));
    try {
      const r = await fetch(`/api/events/${id}/report`, { cache: "no-store" });
      if (r.status === 404) { setState("missing"); return; }
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setState("ok");
    } catch { setState((s) => (s === "ok" ? s : "error")); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  const addrs = useMemo(() => data?.hunters.map((h) => h.address) ?? [], [data]);
  useProfiles(addrs);

  if (state === "missing") {
    return <Shell><div className={`${CARD} p-8 max-w-[520px] mx-auto mt-10 text-center`}><p className="text-xl/none text-heading">Report not found</p></div></Shell>;
  }
  if (state === "error") {
    return (
      <Shell>
        <div className={`${CARD} p-8 max-w-[520px] mx-auto mt-10 flex flex-col items-center gap-4 text-center`} role="alert">
          <p className="text-lg/none text-heading">Couldn&apos;t load the report</p>
          <button type="button" onClick={load} className="h-11 px-6 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer hover:bg-brand/90">
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <div className="flex flex-col gap-5" aria-busy>
          <Skeleton className="h-10 w-2/3" /><Skeleton className="h-6 w-1/2" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        </div>
      </Shell>
    );
  }

  const { event: e, stats: s } = data;
  const now = Math.floor(Date.now() / 1000);
  const over = e.status === "cancelled" || now >= e.endsAt;
  const placed = whole(s.droppedWei), found = whole(s.claimedWei);
  const left = whole(data.unclaimedWei), back = whole(data.reclaimedWei);
  const foundPct = placed > 0 ? Math.round((found / placed) * 100) : 0;
  const perPerson = s.hunters > 0 ? found / s.hunters : 0;
  const maxHour = Math.max(1, ...data.hours.map((h) => h.claims));

  const summary = [
    `${e.title} (${CATEGORY_LABEL[e.category]}), ${formatRange(e.startsAt, e.endsAt, e.tz)}, ${e.venueName}.`,
    `${s.hunters.toLocaleString()} ${s.hunters === 1 ? "person" : "people"} found G$, verified as unique humans with GoodDollar.`,
    `${found.toLocaleString()} G$ found across ${s.claims.toLocaleString()} drops (${foundPct}% of the ${placed.toLocaleString()} G$ placed).`,
    `${data.interested.toLocaleString()} people asked to be reminded.`,
    `All figures are on the Celo blockchain: ${typeof window !== "undefined" ? window.location.origin : "https://www.gooddrops.xyz"}/events/${e.id}`,
  ].join("\n");

  async function copy() {
    try { await navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  }

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6 print:hidden">
        <Link href={`/events/${e.id}`} className="inline-flex items-center gap-2 h-10 pr-3 text-sm/none text-nav-muted hover:text-heading">
          <ArrowLeft className="w-4 h-4" /> Back to the event
        </Link>
        <div className="flex gap-2">
          <button type="button" onClick={copy} className="h-11 px-5 rounded-full border border-line bg-white text-sm/none text-heading flex items-center gap-2 cursor-pointer hover:bg-surface">
            {copied ? <><Check className="w-4 h-4 text-brand" /> Copied</> : <><Copy className="w-4 h-4" /> Copy summary</>}
          </button>
          <button type="button" onClick={() => window.print()} className="h-11 px-5 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer hover:bg-brand/90">
            <Printer className="w-4 h-4" /> Save as PDF
          </button>
        </div>
      </div>

      <header className="mb-6">
        <p className="text-sm/none text-nav-muted">GoodDrops event report{over ? "" : " · so far"}</p>
        <h1 className="mt-3 text-[28px]/[1.15] lg:text-[40px]/[1.1] text-heading break-words">{e.title}</h1>
        <p className="mt-3 text-base/[1.4] text-nav-muted">
          {CATEGORY_LABEL[e.category]} · {formatRange(e.startsAt, e.endsAt, e.tz)} · {e.venueName}
          {e.status === "cancelled" ? " · Cancelled" : ""}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <ProfileAvatar address={e.organizer} size={28} ringColor="transparent" />
          <span className="text-sm/none text-heading">Hosted by <UserHandle address={e.organizer} /></span>
          {e.cohosts.length > 0 && <span className="text-sm/none text-nav-muted">+ {e.cohosts.length} co-host{e.cohosts.length === 1 ? "" : "s"}</span>}
        </div>
      </header>

      <section className={`${CARD} p-6`} aria-label="Results">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile accent value={s.hunters.toLocaleString()} label={s.hunters === 1 ? "person found G$" : "people found G$"} />
          <Tile value={`${found.toLocaleString()} G$`} label="found by people" />
          <Tile value={`${s.claims.toLocaleString()} / ${s.drops.toLocaleString()}`} label="drops claimed" />
          <Tile value={`${foundPct}%`} label="of what was placed got found" />
          <Tile value={`${placed.toLocaleString()} G$`} label={`placed (${e.budgetG.toLocaleString()} planned)`} />
          <Tile value={`${perPerson ? Math.round(perPerson).toLocaleString() : 0} G$`} label="found per person on average" />
          <Tile value={`${left.toLocaleString()} G$`} label={back > 0 ? `unclaimed, plus ${back.toLocaleString()} G$ taken back` : "unclaimed"} />
          <Tile value={data.interested.toLocaleString()} label="asked to be reminded" />
        </div>
        <p className="mt-4 text-xs/[145%] text-nav-muted">
          Each person verified once with GoodDollar&apos;s face check, and linked wallets count as one person. Amounts are read from the Celo blockchain.
        </p>
      </section>

      {data.hours.length > 0 && (
        <section className={`${CARD} p-6 mt-5 break-inside-avoid`} aria-labelledby="hours-h">
          <h2 id="hours-h" className="text-lg/none text-heading">Finds by hour <span className="text-sm text-nav-muted">({tzLabel(e.startsAt, e.tz)})</span></h2>
          <ul className="mt-5 flex flex-col gap-2">
            {data.hours.map((h) => (
              <li key={h.at} className="grid grid-cols-[72px_1fr_88px] items-center gap-3 text-sm/none">
                <span className="text-nav-muted">{new Date(h.at * 1000).toLocaleTimeString("en", { hour: "numeric", timeZone: e.tz })}</span>
                <span className="h-3 rounded-full bg-surface overflow-hidden">
                  <span className="block h-full rounded-full bg-brand print:bg-brand" style={{ width: `${(h.claims / maxHour) * 100}%` }} />
                </span>
                <span className="text-right text-heading">{h.claims} · {Math.round(h.g).toLocaleString()} G$</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${CARD} p-6 mt-5`} aria-labelledby="people-h">
        <h2 id="people-h" className="text-lg/none text-heading">Who found G$</h2>
        {data.hunters.length === 0 ? (
          <p className="mt-4 text-sm/[145%] text-nav-muted">Nobody yet.</p>
        ) : (
          <ol className="mt-4 flex flex-col divide-y divide-line">
            {data.hunters.map((h, i) => (
              <li key={h.address} className="flex items-center gap-3 py-2.5 min-w-0 break-inside-avoid">
                <span className="w-6 text-center text-sm text-nav-muted">{i + 1}</span>
                <ProfileAvatar address={h.address} size={28} ringColor="transparent" />
                <UserHandle address={h.address} className="min-w-0 flex-1 text-sm/none text-heading truncate" />
                <span className="text-sm/none text-nav-muted shrink-0">{h.claims} {h.claims === 1 ? "drop" : "drops"}</span>
                <span className="text-sm/none text-heading shrink-0 w-24 text-right">{formatG$(BigInt(h.wei))} G$</span>
              </li>
            ))}
          </ol>
        )}
        {s.hunters > data.hunters.length && (
          <p className="mt-3 text-xs/none text-nav-muted">Top {data.hunters.length} of {s.hunters.toLocaleString()}.</p>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface font-sans print:bg-white">
      <div className="print:hidden"><Nav /></div>
      <main className="pt-nav print:pt-0">
        <div className="px-4 lg:px-15 pt-6 lg:pt-8 pb-24 max-w-[1000px] mx-auto print:p-0">{children}</div>
      </main>
    </div>
  );
}

function Tile({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 min-w-0 ${accent ? "bg-brand text-white" : "bg-surface"}`}>
      <p className={`font-anta text-[24px]/none truncate ${accent ? "text-white" : "text-heading"}`}>{value}</p>
      <p className={`mt-2 text-xs/[1.3] ${accent ? "text-white/80" : "text-nav-muted"}`}>{label}</p>
    </div>
  );
}
