"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSignMessage } from "wagmi";
import { Check, Loader2, MapPin, Plus, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useLandmarks } from "@/hooks/useLandmarks";
import { track } from "@/lib/analytics";
import {
  CATEGORY_LABEL, EVENT_CATEGORIES, LIMITS, draftDigest, eventMessage, validateDraft,
  type EventCategory, type EventDraft, type GdEvent,
} from "@/lib/events";
import { CATEGORY_ICON } from "./Pieces";
import { fromLocalInput, toLocalInput } from "./format";
import { announceEventsChanged } from "./useEvents";

// The picker holds a live map; load it only when someone opens it.
const LocationPickerSheet = dynamic(
  () => import("@/components/LocationPickerSheet").then((m) => m.LocationPickerSheet),
  { ssr: false },
);

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const FIELD =
  "w-full h-14 rounded-full bg-surface px-5 text-base/none text-heading placeholder:text-nav-muted " +
  "border border-transparent outline-none focus:border-brand motion-safe:transition-colors disabled:opacity-60";
const LABEL = "text-sm/none text-nav-muted mb-2.5 block";

interface Props {
  address: string;
  /** Present when editing. */
  event?: GdEvent | null;
  onClose: () => void;
  onSaved?: (e: GdEvent) => void;
}

/**
 * Create or edit an event. Validates with the exact rules the server uses
 * (lib/events validateDraft), then the organizer signs the normalised content
 * — what admins review is precisely what was signed.
 */
export function EventForm({ address, event, onClose, onSaved }: Props) {
  const editing = !!event;
  const base: EventDraft | null = event ? (event.pendingEdit ?? event) : null;
  const nowSec = Math.floor(Date.now() / 1000);
  const defaultStart = Math.ceil((nowSec + 2 * 86_400) / 3600) * 3600; // two days out, on the hour

  const [title, setTitle] = useState(base?.title ?? "");
  const [category, setCategory] = useState<EventCategory | null>(base?.category ?? null);
  const [description, setDescription] = useState(base?.description ?? "");
  const [venueName, setVenueName] = useState(base?.venueName ?? "");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(base ? { lat: base.lat, lng: base.lng } : null);
  const [start, setStart] = useState(toLocalInput(base?.startsAt ?? defaultStart));
  const [end, setEnd] = useState(toLocalInput(base?.endsAt ?? defaultStart + 3 * 3600));
  const [budget, setBudget] = useState(base ? String(base.budgetG) : "");
  const [link, setLink] = useState(base?.link ?? "");
  const [cohosts, setCohosts] = useState<string[]>(base?.cohosts ?? []);
  const [cohostInput, setCohostInput] = useState("");
  const [cohostErr, setCohostErr] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<GdEvent | null>(null);

  const { landmarks } = useLandmarks();
  const { signMessageAsync } = useSignMessage();

  const startsAt = fromLocalInput(start);
  const endsAt = fromLocalInput(end);
  const live = editing && event!.status === "approved" && nowSec >= event!.startsAt;

  const raw = {
    title, description, category: category ?? "", venueName, lat: pin?.lat, lng: pin?.lng,
    startsAt, endsAt, budgetG: Number(budget), link, cohosts,
  };
  const check = useMemo(
    () => validateDraft(raw, Math.floor(Date.now() / 1000), { organizer: address, allowStarted: live }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, description, category, venueName, pin, startsAt, endsAt, budget, link, cohosts, address, live],
  );

  // Inline time feedback as soon as both are set — the most common mistake.
  const timeError =
    Number.isFinite(startsAt) && Number.isFinite(endsAt)
      ? endsAt <= startsAt ? "It has to end after it starts. Check the end time."
        : endsAt - startsAt < LIMITS.minDurationS ? "Make it at least 30 minutes long."
        : endsAt - startsAt > LIMITS.maxDurationS ? "Events can last at most 7 days."
        : !live && startsAt < nowSec - 300 ? "The start time is in the past."
        : ""
      : "";

  function addCohost() {
    const a = cohostInput.trim();
    if (!ADDR_RE.test(a)) { setCohostErr("That isn't a wallet address (0x… 42 characters)."); return; }
    const lower = a.toLowerCase();
    if (lower === address.toLowerCase()) { setCohostErr("You're already the organizer."); return; }
    if (cohosts.includes(lower)) { setCohostErr("Already added."); return; }
    if (cohosts.length >= LIMITS.maxCohosts) { setCohostErr(`At most ${LIMITS.maxCohosts} co-hosts.`); return; }
    setCohosts([...cohosts, lower]);
    setCohostInput("");
    setCohostErr("");
  }

  async function submit() {
    setTouched(true);
    if (!check.ok) { setError(check.error); return; }
    setBusy(true);
    setError("");
    const draft = check.value;
    const action = editing ? "edit" : "create";
    const id = editing ? event!.id : "new";
    try {
      const timestamp = Date.now();
      const signature = await signMessageAsync({ message: eventMessage(action, id, timestamp, draftDigest(draft)) });
      const res = await fetch(editing ? `/api/events/${id}` : "/api/events", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing
          ? { action: "edit", draft, address, signature, timestamp }
          : { draft, address, signature, timestamp }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? "Couldn't save the event. Try again."); return; }
      if (!editing) track("event_submitted", { category: draft.category });
      setDone(body.event as GdEvent);
      onSaved?.(body.event as GdEvent);
      announceEventsChanged();
    } catch (e) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "";
      // Declining the signature isn't an error.
      if (!/reject|denied|cancel/i.test(m)) setError("Couldn't save the event. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const title_ = done
    ? (editing ? "Changes sent for review" : "Event submitted")
    : editing ? "Edit event" : "Host an event";

  return (
    <>
      <Sheet title={title_} onClose={onClose} width={560} dismissible={!busy && !pickerOpen} zIndex={1400}>
        {done ? (
          <div className="flex flex-col items-center text-center pt-6 gap-y-4">
            <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
              <Check className="w-7 h-7" />
            </span>
            <p className="text-lg/[1.3] text-heading">{done.title}</p>
            <p className="text-sm/[150%] text-nav-muted max-w-[420px]">
              {editing && done.status === "approved"
                ? "Your event stays live as it was while we review the changes. We'll notify you when they're approved."
                : "We review every event before it goes public, usually within a day. We'll notify you when it's approved, and then you can add your drops."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer motion-safe:transition-colors hover:bg-brand/90"
            >
              Done
            </button>
          </div>
        ) : (
          <form className="pt-6 flex flex-col gap-6" onSubmit={(ev) => { ev.preventDefault(); submit(); }} noValidate>
            {editing && event!.status === "approved" && (
              <p className="rounded-2xl bg-streak-bg text-sm/[145%] text-heading px-4 py-3">
                Changes to a live event are reviewed first. Hunters keep seeing the current version until they&apos;re approved.
              </p>
            )}
            {editing && event!.status === "rejected" && event!.rejectReason && (
              <p className="rounded-2xl bg-danger/10 text-sm/[145%] text-danger px-4 py-3">Reviewer note: {event!.rejectReason}</p>
            )}

            <div>
              <label className={LABEL} htmlFor="ev-title">Event name</label>
              <input id="ev-title" className={FIELD} value={title} maxLength={LIMITS.titleMax} disabled={busy}
                placeholder="e.g. Campus Treasure Hunt" onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div>
              <span className={LABEL}>Category</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
                {EVENT_CATEGORIES.map((c) => {
                  const Icon = CATEGORY_ICON[c];
                  const on = category === c;
                  return (
                    <button key={c} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => setCategory(c)}
                      className={`h-11 px-4 rounded-full text-sm/none flex items-center gap-2 cursor-pointer motion-safe:transition-colors
                        ${on ? "bg-nav-active text-white" : "border border-line bg-white text-heading hover:bg-surface"}`}>
                      <Icon className="w-4 h-4" strokeWidth={1.75} /> {CATEGORY_LABEL[c]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={LABEL} htmlFor="ev-desc">What&apos;s happening <span className="text-nav-muted/70">(optional)</span></label>
              <textarea id="ev-desc" value={description} maxLength={LIMITS.descriptionMax} disabled={busy} rows={4}
                placeholder="Who it's for, what to bring, how the hunt works…"
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-3xl bg-surface px-5 py-4 text-base/[1.4] text-heading placeholder:text-nav-muted border border-transparent outline-none focus:border-brand resize-y min-h-28" />
              <span className="mt-1.5 block text-right text-xs/none text-nav-muted">{description.length}/{LIMITS.descriptionMax}</span>
            </div>

            <div>
              <span className={LABEL}>Venue</span>
              <button type="button" disabled={busy} onClick={() => setPickerOpen(true)}
                className="w-full rounded-2xl bg-surface p-3 pr-5 flex items-center gap-3 text-left cursor-pointer motion-safe:transition-colors hover:bg-nav-controls">
                <span className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center ${pin ? "bg-brand text-white" : "bg-white text-heading"}`}>
                  <MapPin className="w-5 h-5" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex flex-col gap-1">
                  <span className="text-base/none text-heading">{pin ? "Venue pinned" : "Pin the venue on the map"}</span>
                  <span className="text-sm/none text-nav-muted truncate">
                    {pin ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)} · change` : "Hunters see this spot and get directions to it"}
                  </span>
                </span>
              </button>
              <input aria-label="Venue name" className={`${FIELD} mt-3`} value={venueName} maxLength={LIMITS.venueMax} disabled={busy}
                placeholder="Venue name, e.g. Faculty of Arts quad" onChange={(e) => setVenueName(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL} htmlFor="ev-start">Starts</label>
                <input id="ev-start" type="datetime-local" className={FIELD} value={start} disabled={busy || live}
                  onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <label className={LABEL} htmlFor="ev-end">Ends</label>
                <input id="ev-end" type="datetime-local" className={FIELD} value={end} disabled={busy}
                  min={start} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!timeError} />
              </div>
              <p className={`sm:col-span-2 -mt-2 text-sm/none ${timeError ? "text-danger" : "text-nav-muted"}`} role="status">
                {timeError || (live ? "It has started, so only the end time can change." : "Shown in your local time.")}
              </p>
            </div>

            <div>
              <label className={LABEL} htmlFor="ev-budget">G$ budget</label>
              <div className="relative">
                <input id="ev-budget" inputMode="numeric" className={`${FIELD} pr-14`} value={budget} disabled={busy}
                  placeholder="e.g. 5000" onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))} />
                <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-base/none text-nav-muted">G$</span>
              </div>
              <p className="mt-2 text-sm/[140%] text-nav-muted">This is what hunters see. Drops are funded when you place them, up to 500 G$ each.</p>
            </div>

            <div>
              <label className={LABEL} htmlFor="ev-link">Event link <span className="text-nav-muted/70">(optional)</span></label>
              <input id="ev-link" className={FIELD} value={link} disabled={busy} inputMode="url" autoCapitalize="none"
                placeholder="Tickets or RSVP page" onChange={(e) => setLink(e.target.value)} />
            </div>

            <div>
              <span className={LABEL}>Co-hosts <span className="text-nav-muted/70">(optional, can add drops for this event)</span></span>
              {cohosts.length > 0 && (
                <ul className="flex flex-col gap-2 mb-3">
                  {cohosts.map((a) => (
                    <li key={a} className="flex items-center gap-2 rounded-full border border-line pl-4 pr-1.5 h-11">
                      <span className="flex-1 min-w-0 truncate text-sm/none text-heading">{a}</span>
                      <button type="button" aria-label={`Remove ${a}`} disabled={busy}
                        onClick={() => setCohosts(cohosts.filter((x) => x !== a))}
                        className="w-8 h-8 rounded-full bg-surface flex items-center justify-center cursor-pointer hover:bg-nav-controls">
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {cohosts.length < LIMITS.maxCohosts && (
                <div className="flex gap-2">
                  <input aria-label="Co-host wallet address" className={FIELD} value={cohostInput} disabled={busy}
                    placeholder="0x… wallet address" autoCapitalize="none" spellCheck={false}
                    onChange={(e) => { setCohostInput(e.target.value); setCohostErr(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCohost(); } }} />
                  <button type="button" onClick={addCohost} disabled={busy || !cohostInput.trim()} aria-label="Add co-host"
                    className="w-14 h-14 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center cursor-pointer hover:bg-nav-controls disabled:opacity-50">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              )}
              {cohostErr && <p className="mt-2 text-sm/none text-danger">{cohostErr}</p>}
            </div>

            <div className="flex flex-col gap-3">
              <p className={`min-h-5 text-sm/[140%] ${error ? "text-danger" : "text-nav-muted"}`} role="alert" aria-live="polite">
                {error || (touched && !check.ok ? check.error : "")}
              </p>
              <button type="submit" disabled={busy}
                className="w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer
                  motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-wait">
                {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Waiting for signature…</> : editing ? "Save changes" : "Submit for review"}
              </button>
              <p className="text-xs/[145%] text-nav-muted text-center">
                You&apos;ll sign a message to prove it&apos;s you. Free, no gas.
              </p>
            </div>
          </form>
        )}
      </Sheet>

      {pickerOpen && (
        <LocationPickerSheet
          open
          initialCenter={pin}
          landmarks={landmarks}
          confirmLabel="Pin the venue here"
          onClose={() => setPickerOpen(false)}
          onConfirm={(lat, lng, name) => {
            setPin({ lat, lng });
            if (name && !venueName.trim()) setVenueName(name.slice(0, LIMITS.venueMax));
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}
