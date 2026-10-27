"use client";
import { useMemo, useState } from "react";
import { Activity, CalendarPlus, Loader2, Navigation, RefreshCw, Ticket } from "lucide-react";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/hooks/useAuth";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { haversineDistance } from "@/lib/utils";
import type { GdEvent } from "@/lib/events";
import { EventCard, EventCardSkeleton } from "@/components/events/EventCard";
import { EventForm } from "@/components/events/EventForm";
import { CancelEventSheet } from "@/components/events/CancelEventSheet";
import { HostEvents } from "@/components/events/HostEvents";
import { useEventLists, useHostEvents, useNowSec, type EventRow } from "@/components/events/useEvents";

const PAST_STEP = 6;

export default function EventsPage() {
  const { login } = useAuth();
  const { address } = useSignedInAccount();
  const now = useNowSec(30_000);
  const lists = useEventLists();
  const mine = useHostEvents(address);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GdEvent | null>(null);
  const [cancelling, setCancelling] = useState<GdEvent | null>(null);
  const [pastShown, setPastShown] = useState(PAST_STEP);

  // Distance only after the person asks — never an unprompted location prompt.
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<"idle" | "busy" | "denied">("idle");
  function locate() {
    if (!navigator.geolocation) { setLocating("denied"); return; }
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating("idle"); },
      () => setLocating("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  const byDistance = (rows: EventRow[]) =>
    here ? [...rows].sort((a, b) => haversineDistance(here.lat, here.lng, a.event.lat, a.event.lng) - haversineDistance(here.lat, here.lng, b.event.lat, b.event.lng)) : rows;

  const data = lists.data;
  const live = useMemo(() => byDistance(data?.live ?? []), [data, here]); // eslint-disable-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => (here ? byDistance(data?.upcoming ?? []) : data?.upcoming ?? []), [data, here]); // eslint-disable-line react-hooks/exhaustive-deps
  const past = data?.past ?? [];
  const nothingOn = !!data && live.length === 0 && upcoming.length === 0;
  const myRows = mine.data?.events ?? [];

  function host() {
    if (!address) { login(); return; }
    setCreating(true);
  }

  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <main className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-24">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-8">
            <div className="min-w-0">
              <h1 className="text-[32px]/none lg:text-4xl/none text-heading">Events</h1>
              <p className="mt-3 text-sm/[145%] lg:text-base/[145%] text-nav-muted max-w-[560px]">
                Meetups, concerts and campus days with real G$ hidden around them. Show up, hunt, and see the numbers live.
              </p>
            </div>
            <div className="flex gap-2.5 shrink-0">
              <button type="button" onClick={locate} disabled={locating === "busy"}
                className="h-12 px-5 rounded-full border border-line bg-white text-sm/none text-heading flex items-center gap-2 cursor-pointer hover:bg-surface disabled:opacity-60">
                {locating === "busy" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" strokeWidth={2} />}
                {here ? "Sorted by distance" : "Near me"}
              </button>
              <button type="button" onClick={host}
                className="h-12 px-5 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer hover:bg-brand/90">
                <CalendarPlus className="w-4 h-4" strokeWidth={2} /> Host an event
              </button>
            </div>
          </div>
          {locating === "denied" && (
            <p className="-mt-4 mb-6 text-sm/[145%] text-nav-muted">Location is off, so events are sorted by time. Turn it on in your browser to see distances.</p>
          )}

          {/* Your events */}
          {address && myRows.length > 0 && (
            <section className="mb-10" aria-labelledby="mine-h">
              <h2 id="mine-h" className="text-xl/none text-heading mb-4">Your events</h2>
              <HostEvents rows={myRows} now={now} onEdit={setEditing} onCancel={setCancelling} />
            </section>
          )}

          {lists.loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }, (_, i) => <EventCardSkeleton key={i} />)}
            </div>
          )}

          {lists.error && (
            <div className="bg-white rounded-3xl p-8 text-center flex flex-col items-center gap-4 shadow-[0px_0px_12px_0px_#0000000A]" role="alert">
              <p className="text-lg/none text-heading">Couldn&apos;t load events</p>
              <p className="text-sm/[145%] text-nav-muted">Check your connection and try again.</p>
              <button type="button" onClick={lists.refresh}
                className="h-11 px-6 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer hover:bg-brand/90">
                <RefreshCw className="w-4 h-4" /> Try again
              </button>
            </div>
          )}

          {data && (
            <div className="flex flex-col gap-10">
              {live.length > 0 && (
                <Section title="Live now" live count={live.length}>
                  {live.map((r) => <EventCard key={r.event.id} row={r} now={now} here={here} loud />)}
                </Section>
              )}

              {upcoming.length > 0 && (
                <Section title="Upcoming" count={upcoming.length}>
                  {upcoming.map((r) => <EventCard key={r.event.id} row={r} now={now} here={here} />)}
                </Section>
              )}

              {nothingOn && (
                <div className="bg-white rounded-3xl p-8 lg:p-10 shadow-[0px_0px_12px_0px_#0000000A] flex flex-col items-center text-center">
                  <span className="w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
                    <Ticket className="w-7 h-7" strokeWidth={1.75} />
                  </span>
                  <p className="mt-5 text-xl/none text-heading">Nothing on right now</p>
                  <p className="mt-3 text-sm/[150%] text-nav-muted max-w-[460px]">
                    Running a meetup, a show or a campus day? Hide G$ around it. People come for the event and stay for the hunt,
                    and you get live numbers on who showed up.
                  </p>
                  <button type="button" onClick={host}
                    className="mt-6 h-12 px-6 rounded-full bg-brand text-white text-sm/none flex items-center gap-2 cursor-pointer hover:bg-brand/90">
                    <CalendarPlus className="w-4 h-4" strokeWidth={2} /> Host an event
                  </button>
                </div>
              )}

              {past.length > 0 && (
                <Section title="Past" count={past.length}>
                  {past.slice(0, pastShown).map((r) => <EventCard key={r.event.id} row={r} now={now} />)}
                  {past.length > pastShown && (
                    <div className="md:col-span-2 xl:col-span-3 flex justify-center">
                      <button type="button" onClick={() => setPastShown((n) => n + PAST_STEP)}
                        className="h-11 px-6 rounded-full border border-line bg-white text-sm/none text-heading cursor-pointer hover:bg-surface">
                        Show more
                      </button>
                    </div>
                  )}
                </Section>
              )}
            </div>
          )}
        </div>
      </main>

      {(creating || editing) && address && (
        <EventForm
          address={address}
          event={editing}
          onClose={() => { setCreating(false); setEditing(null); mine.refresh(); }}
          onSaved={() => mine.refresh()}
        />
      )}
      {cancelling && address && (
        <CancelEventSheet event={cancelling} address={address} onClose={() => setCancelling(null)} onCancelled={() => { mine.refresh(); lists.refresh(); }} />
      )}
    </div>
  );
}

function Section({ title, count, live = false, children }: { title: string; count: number; live?: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="flex items-center gap-2.5 text-xl/none text-heading mb-4">
        {live && (
          <Activity aria-hidden className="w-5 h-5 text-brand" strokeWidth={2} />
        )}
        {title}
        <span className="text-sm/none text-nav-muted">{count}</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}
