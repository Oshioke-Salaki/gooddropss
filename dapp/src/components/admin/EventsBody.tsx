"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays, Check, Clock, ExternalLink, MapPin, PencilLine, Trash2, X, Users, Wallet, ArrowRight,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useProfiles } from "@/hooks/useProfile";
import { shortAddr } from "@/lib/utils";
import {
  CATEGORY_LABEL, eventPhase, type EventDraft, type EventStatsJson, type GdEvent,
} from "@/lib/events";
import { AdminPage, Button, Card, EmptyState, Hint, RowsSkeleton, SectionTitle, Tag, timeAgo } from "@/components/admin/ui";

interface Row { event: GdEvent; stats: EventStatsJson }
type Action = "approve" | "reject" | "approveEdit" | "rejectEdit" | "remove";

const QUICK_REASONS = [
  "Needs an exact venue",
  "Date or time is wrong",
  "Looks like spam",
  "Not a real-world event",
  "Budget looks unrealistic",
];

// ── Formatting ────────────────────────────────────────────────────────────────

const tzLabel = () =>
  new Intl.DateTimeFormat("en", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";

function when(s: number): string {
  return new Date(s * 1000).toLocaleString("en", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function duration(a: number, b: number): string {
  const m = Math.round((b - a) / 60);
  if (m < 60) return `${m} min`;
  const h = m / 60;
  if (h < 24) return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  const d = h / 24;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} days`;
}
const g = (n: number) => `${n.toLocaleString("en")} G$`;
const weiG = (w: string) => g(Math.round(Number(BigInt(w) / 10n ** 15n) / 1000));

const STATUS: Record<GdEvent["status"], { label: string; tone: "good" | "warn" | "bad" | "muted" | "dark" }> = {
  pending: { label: "Pending review", tone: "warn" },
  approved: { label: "Live", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export function EventsBody() {
  const [review, setReview] = useState<Row[] | null>(null);
  const [recent, setRecent] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [reasonFor, setReasonFor] = useState<{ row: Row; action: "reject" | "rejectEdit" | "remove" } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/events", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { review: Row[]; recent: Row[] };
      setReview(d.review);
      setRecent(d.recent);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // One batch for every organizer/co-host handle on the page.
  const addresses = useMemo(() => {
    const s = new Set<string>();
    for (const r of [...(review ?? []), ...(recent ?? [])]) { s.add(r.event.organizer); r.event.cohosts.forEach((c) => s.add(c)); }
    return [...s];
  }, [review, recent]);
  const profiles = useProfiles(addresses);
  const handle = (a: string) => (profiles[a]?.username ? `@${profiles[a]!.username}` : shortAddr(a));

  // Organizer track record from what's on the page (recent covers the last 100).
  const history = useMemo(() => {
    const m = new Map<string, Record<GdEvent["status"], number>>();
    for (const r of recent ?? []) {
      const c = m.get(r.event.organizer) ?? { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
      c[r.event.status] += 1;
      m.set(r.event.organizer, c);
    }
    return m;
  }, [recent]);

  async function act(row: Row, action: Action, reason?: string) {
    const id = row.event.id;
    const prevReview = review, prevRecent = recent;
    // Optimistic: the card leaves the queue (or updates) at once; rolled back on failure.
    const optimistic = (e: GdEvent): GdEvent =>
      action === "approve" ? { ...e, status: "approved" }
      : action === "reject" ? { ...e, status: "rejected", rejectReason: reason }
      : action === "approveEdit" ? { ...e, ...(e.pendingEdit as EventDraft), pendingEdit: null }
      : action === "rejectEdit" ? { ...e, pendingEdit: null }
      : { ...e, status: "rejected", rejectReason: `Removed: ${reason}` };
    setBusy(`${id}:${action}`);
    setHint(null);
    setReview((r) => r?.filter((x) => x.event.id !== id) ?? r);
    setRecent((r) => r?.map((x) => (x.event.id === id ? { ...x, event: optimistic(x.event) } : x)) ?? r);
    try {
      const res = await fetch(`/api/admin/events/${id}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "That didn't go through.");
      setHint({
        tone: "ok",
        text: action === "approve" ? `${row.event.title} is live.`
          : action === "approveEdit" ? "Changes are live."
          : action === "remove" ? `${row.event.title} was taken down.`
          : "Sent back to the organizer.",
      });
      window.dispatchEvent(new CustomEvent("gd:events-updated"));
      load();
    } catch (e) {
      setReview(prevReview);
      setRecent(prevRecent);
      setHint({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminPage
      title={<>Events {review && review.length > 0 && <Tag tone="warn">{review.length} to review</Tag>}</>}
      subtitle="Nothing is public until it's approved here. Organizers are notified of every decision."
      width="max-w-[1040px]"
    >
      <Hint text={hint?.text} tone={hint?.tone} className="mb-4" />

      {error && !review ? (
        <Card className="flex flex-col items-center text-center gap-3 py-10">
          <p className="text-lg/none text-heading">Couldn&apos;t load events</p>
          <Button variant="primary" onClick={load}>Try again</Button>
        </Card>
      ) : review === null ? (
        <RowsSkeleton count={2} height="h-64" />
      ) : (
        <>
          <SectionTitle className="mb-4">Review queue</SectionTitle>
          {review.length === 0 ? (
            <Card><EmptyState icon={Check} title="All caught up" body="New events and edits to live events show up here." /></Card>
          ) : (
            <div className="flex flex-col gap-4">
              {review.map((row) => (
                <ReviewCard
                  key={row.event.id}
                  row={row}
                  handle={handle}
                  history={history.get(row.event.organizer)}
                  busy={busy}
                  onApprove={() => act(row, row.event.pendingEdit ? "approveEdit" : "approve")}
                  onReject={() => setReasonFor({ row, action: row.event.pendingEdit ? "rejectEdit" : "reject" })}
                />
              ))}
            </div>
          )}

          <SectionTitle className="mt-10 mb-4">All events</SectionTitle>
          {recent && recent.length === 0 ? (
            <Card><EmptyState icon={CalendarDays} title="No events yet" /></Card>
          ) : (
            <div className="flex flex-col gap-3">
              {(recent ?? []).map((row) => (
                <EventRow key={row.event.id} row={row} handle={handle} busy={busy}
                  onRemove={() => setReasonFor({ row, action: "remove" })} />
              ))}
            </div>
          )}
        </>
      )}

      {reasonFor && (
        <ReasonSheet
          title={reasonFor.action === "remove" ? `Take down ${reasonFor.row.event.title}?` : reasonFor.action === "rejectEdit" ? "Reject these changes" : `Reject ${reasonFor.row.event.title}`}
          danger={reasonFor.action === "remove"}
          cta={reasonFor.action === "remove" ? "Take it down" : "Send back"}
          onClose={() => setReasonFor(null)}
          onSubmit={(reason) => { const r = reasonFor; setReasonFor(null); act(r.row, r.action, reason); }}
        />
      )}
    </AdminPage>
  );
}

// ── Review card ───────────────────────────────────────────────────────────────

function ReviewCard({
  row, handle, history, busy, onApprove, onReject,
}: {
  row: Row; handle: (a: string) => string; history?: Record<GdEvent["status"], number>; busy: string | null;
  onApprove: () => void; onReject: () => void;
}) {
  const e = row.event;
  const isEdit = !!e.pendingEdit;
  const shown = (e.pendingEdit ?? e) as EventDraft;
  const others = history ? Object.values(history).reduce((s, n) => s + n, 0) - 1 : 0;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Tag tone={isEdit ? "dark" : "warn"}>{isEdit ? <><PencilLine className="w-3.5 h-3.5" /> Edit to a live event</> : <><Clock className="w-3.5 h-3.5" /> New event</>}</Tag>
            <Tag>{CATEGORY_LABEL[shown.category]}</Tag>
            <span className="text-xs/none text-nav-muted">Submitted {timeAgo(isEdit ? e.updatedAt : e.createdAt)}</span>
          </div>
          <h3 className="text-xl/[1.2] text-heading break-words">{shown.title}</h3>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onReject} disabled={!!busy}>
            <X className="w-4 h-4" /> {isEdit ? "Reject edit" : "Reject"}
          </Button>
          <Button variant="primary" className="flex-1 sm:flex-none" onClick={onApprove}
            busy={busy === `${e.id}:${isEdit ? "approveEdit" : "approve"}`} disabled={!!busy}>
            {busy ? null : <Check className="w-4 h-4" />} {isEdit ? "Approve edit" : "Approve"}
          </Button>
        </div>
      </div>

      {isEdit ? (
        <EditDiff before={e} after={e.pendingEdit as EventDraft} handle={handle} />
      ) : (
        <>
          {shown.description && (
            <p className="text-sm/[150%] text-heading whitespace-pre-line break-words bg-surface rounded-2xl p-4">{shown.description}</p>
          )}
          <Facts d={shown} handle={handle} />
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-line">
        <ProfileAvatar address={e.organizer} size={32} ringColor="transparent" />
        <div className="min-w-0 flex-1">
          <Link href={`/hunter/${e.organizer}`} target="_blank" className="text-sm/none text-heading hover:underline">{handle(e.organizer)}</Link>
          <p className="text-xs/none text-nav-muted mt-1.5 truncate">{e.organizer}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {others > 0 ? (
            <>
              <span className="text-xs/none text-nav-muted self-center mr-1">Their other events:</span>
              {history!.approved > 0 && <Tag tone="good">{history!.approved} approved</Tag>}
              {history!.rejected > 0 && <Tag tone="bad">{history!.rejected} rejected</Tag>}
              {history!.pending - (e.status === "pending" ? 1 : 0) > 0 && <Tag tone="warn">{history!.pending - (e.status === "pending" ? 1 : 0)} pending</Tag>}
              {history!.cancelled > 0 && <Tag>{history!.cancelled} cancelled</Tag>}
            </>
          ) : (
            <Tag>First event</Tag>
          )}
        </div>
      </div>
    </Card>
  );
}

function Facts({ d, handle }: { d: EventDraft; handle: (a: string) => string }) {
  const items: { Icon: typeof MapPin; label: string; value: React.ReactNode }[] = [
    {
      Icon: MapPin, label: "Venue",
      value: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {d.venueName}
          <Link href={`/?focus=${d.lat},${d.lng}`} target="_blank" className="text-brand text-xs/none inline-flex items-center gap-1 hover:underline">
            View on map <ArrowRight className="w-3 h-3" />
          </Link>
        </span>
      ),
    },
    { Icon: CalendarDays, label: `When (${tzLabel()})`, value: <>{when(d.startsAt)} – {when(d.endsAt)} <span className="text-nav-muted">· {duration(d.startsAt, d.endsAt)}</span></> },
    { Icon: Wallet, label: "Budget", value: g(d.budgetG) },
  ];
  if (d.link) {
    items.push({
      Icon: ExternalLink, label: "Link",
      value: <a href={d.link} target="_blank" rel="noopener noreferrer nofollow" className="text-brand break-all hover:underline">{d.link}</a>,
    });
  }
  if (d.cohosts.length) items.push({ Icon: Users, label: "Co-hosts", value: d.cohosts.map(handle).join(", ") });
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      {items.map(({ Icon, label, value }) => (
        <div key={label} className="flex gap-3 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center"><Icon className="w-4 h-4" strokeWidth={1.75} /></span>
          <div className="min-w-0">
            <dt className="text-xs/none text-nav-muted">{label}</dt>
            <dd className="text-sm/[140%] text-heading mt-1.5 break-words">{value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/** Only the fields that changed, before → after. */
function EditDiff({ before, after, handle }: { before: EventDraft; after: EventDraft; handle: (a: string) => string }) {
  const rows: { label: string; a: string; b: string }[] = [];
  const add = (label: string, a: string, b: string) => { if (a !== b) rows.push({ label, a, b }); };
  add("Title", before.title, after.title);
  add("Category", CATEGORY_LABEL[before.category], CATEGORY_LABEL[after.category]);
  add("Description", before.description || "—", after.description || "—");
  add("Venue", before.venueName, after.venueName);
  add("Pin", `${before.lat.toFixed(5)}, ${before.lng.toFixed(5)}`, `${after.lat.toFixed(5)}, ${after.lng.toFixed(5)}`);
  add("Starts", when(before.startsAt), when(after.startsAt));
  add("Ends", when(before.endsAt), when(after.endsAt));
  add("Budget", g(before.budgetG), g(after.budgetG));
  add("Link", before.link || "—", after.link || "—");
  add("Co-hosts", before.cohosts.map(handle).join(", ") || "—", after.cohosts.map(handle).join(", ") || "—");

  if (rows.length === 0) return <p className="text-sm/none text-nav-muted">No visible changes.</p>;
  return (
    <div className="rounded-2xl border border-line divide-y divide-line overflow-hidden">
      <div className="hidden sm:grid grid-cols-[120px_1fr_1fr] gap-4 px-4 py-2.5 bg-surface text-xs/none text-nav-muted">
        <span>Field</span><span>Live now</span><span>Proposed</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr] gap-1.5 sm:gap-4 px-4 py-3 text-sm/[140%]">
          <span className="text-nav-muted text-xs/none sm:text-sm/[140%]">{r.label}</span>
          <span className="text-nav-muted line-through decoration-nav-muted/40 break-words whitespace-pre-line">{r.a}</span>
          <span className="text-heading break-words whitespace-pre-line">{r.b}</span>
        </div>
      ))}
      {(before.lat !== after.lat || before.lng !== after.lng) && (
        <div className="px-4 py-3">
          <Link href={`/?focus=${after.lat},${after.lng}`} target="_blank" className="text-brand text-sm/none inline-flex items-center gap-1 hover:underline">
            See the new pin on the map <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

// ── List row ─────────────────────────────────────────────────────────────────

function EventRow({ row, handle, busy, onRemove }: { row: Row; handle: (a: string) => string; busy: string | null; onRemove: () => void }) {
  const e = row.event;
  const now = Math.floor(Date.now() / 1000);
  const st = STATUS[e.status];
  const phase = e.status === "approved" ? eventPhase(e, now) : null;
  return (
    <Card className="flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Tag tone={st.tone}>{phase === "upcoming" ? "Approved · upcoming" : phase === "ended" ? "Ended" : st.label}</Tag>
          {e.pendingEdit && <Tag tone="dark">Edit pending</Tag>}
          <Tag>{CATEGORY_LABEL[e.category]}</Tag>
        </div>
        <Link href={`/events/${e.id}`} target="_blank" className="text-base/[1.3] text-heading hover:underline break-words">{e.title}</Link>
        <p className="text-sm/[140%] text-nav-muted mt-1.5">
          {when(e.startsAt)} · {e.venueName} · by {handle(e.organizer)}
        </p>
        {e.rejectReason && <p className="text-xs/[140%] text-danger mt-1.5 break-words">{e.rejectReason}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        <Tag>Budget {g(e.budgetG)}</Tag>
        <Tag>{row.stats.drops} drops · {weiG(row.stats.droppedWei)}</Tag>
        <Tag tone={row.stats.claims ? "good" : "muted"}>{row.stats.hunters} hunters · {weiG(row.stats.claimedWei)} claimed</Tag>
      </div>
      {e.status === "approved" && phase !== "ended" && (
        <Button variant="danger" size="sm" onClick={onRemove} disabled={!!busy} busy={busy === `${e.id}:remove`}>
          {busy === `${e.id}:remove` ? null : <Trash2 className="w-4 h-4" />} Take down
        </Button>
      )}
    </Card>
  );
}

// ── Reason sheet ─────────────────────────────────────────────────────────────

function ReasonSheet({
  title, cta, danger, onClose, onSubmit,
}: { title: string; cta: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Sheet title={title} onClose={onClose} width={480} zIndex={1500}>
      <p className="text-sm/[140%] text-nav-muted mt-3">The organizer sees this word for word, so make it something they can fix.</p>
      <div className="flex flex-wrap gap-2 mt-4">
        {QUICK_REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)}
            className={`h-9 px-3.5 rounded-full text-sm/none cursor-pointer motion-safe:transition-colors ${reason === r ? "bg-nav-active text-white" : "bg-white border border-line text-heading hover:bg-surface"}`}>
            {r}
          </button>
        ))}
      </div>
      <label className="block mt-4">
        <span className="sr-only">Reason</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 300))}
          rows={3}
          placeholder="Or write your own…"
          className="w-full rounded-2xl bg-surface p-4 text-sm/[140%] text-heading placeholder:text-nav-muted border border-transparent outline-none focus:border-brand resize-none"
        />
      </label>
      <p className="text-xs/none text-nav-muted text-right mt-1">{reason.length}/300</p>
      <div className="grid grid-cols-2 gap-2.5 mt-5">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={!ok} onClick={() => onSubmit(reason.trim())}>{cta}</Button>
      </div>
    </Sheet>
  );
}
