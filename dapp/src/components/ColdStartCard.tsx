"use client";
import { useMemo, useState, useEffect, useRef } from "react";
import { X, Bell, MapPin, Check, Loader2, Navigation, Radar, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { haversineDistance, formatG$, gpsToDeg } from "@/lib/utils";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { DROP_STATUS, type Drop, type LatLng } from "@/types";

interface Props {
  drops:    Drop[];
  userLoc:  LatLng | null;
  loading:  boolean;
  onDrop:   () => void;
  /** Fly the map to a point (the nearest live drop). */
  onShowNearest?: (lat: number, lng: number) => void;
  /** The soonest live or upcoming event, so an empty map can point somewhere real. */
  nextEvent?: { id: string; title: string; when: string; live: boolean; budget: string } | null;
}

function formatKm(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace(/\.0$/, "") : Math.round(km).toLocaleString()} km`;
}

// If the nearest live drop is farther than this, treat the user as "unseeded".
const NEAR_THRESHOLD_M = 25_000; // 25 km

/**
 * Cold-start capture. When a hunter has no drops near them, we don't dead-end
 * on an empty map — we show worldwide proof-of-life, a "notify me here" hook,
 * and a prompt to seed the first local drop themselves.
 */
export function ColdStartCard({ drops, userLoc, loading, onDrop, onShowNearest, nextEvent }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const { status, subscribe }     = usePushSubscription();
  const { address } = useAccount();
  const { login } = useAuth();
  const [subscribing, setSubscribing] = useState(false);

  const now = Math.floor(Date.now() / 1000);

  const { activeDrops, totalHiddenWei, nearestM, nearest } = useMemo(() => {
    const active = drops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > now);
    const totalWei = active.reduce((s, d) => s + d.amount, 0n);
    let best = Infinity;
    let at: { lat: number; lng: number } | null = null;
    if (userLoc) {
      for (const d of active) {
        const lat = gpsToDeg(d.lat), lng = gpsToDeg(d.lng);
        const dist = haversineDistance(userLoc.lat, userLoc.lng, lat, lng);
        if (dist < best) { best = dist; at = { lat, lng }; }
      }
    }
    return { activeDrops: active, totalHiddenWei: totalWei, nearestM: best, nearest: at };
  }, [drops, userLoc, now]);

  // Only surface when we've finished loading and the user is genuinely unseeded:
  // either there are no live drops at all, or we know their location AND the
  // closest drop is beyond the near threshold. Without a known location we
  // can't claim "no drops near you", so we stay hidden.
  const isUnseeded =
    !loading &&
    (activeDrops.length === 0 || (userLoc !== null && nearestM > NEAR_THRESHOLD_M));
  const visible = !dismissed && isUnseeded;

  // Publish our height so the map's floating controls (zoom, locate, the Drop
  // buttons) lift above the sheet instead of sitting on top of it. Measured
  // rather than hardcoded because the copy — and therefore the height — changes
  // between the "no drops at all" and "drops exist but far away" states.
  //
  // Only below lg: there the card spans the width and really does cover the
  // controls. At lg and up it's a 440px panel in the middle with the controls
  // clear on either side, so lifting them would just leave them floating.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.setProperty("--gd-cold-inset", "0px");
    const el = cardRef.current;
    if (!visible || !el) { clear(); return clear; }

    const wide = window.matchMedia("(min-width: 1024px)");
    const publish = () =>
      root.style.setProperty("--gd-cold-inset", wide.matches ? "0px" : `${el.offsetHeight + 12}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    wide.addEventListener("change", publish);
    return () => { ro.disconnect(); wide.removeEventListener("change", publish); clear(); };
  }, [visible]);

  if (!visible) return null;

  async function handleNotify() {
    // Nearby-drop alerts are tied to a wallet (that's where the server keeps the
    // subscription and the last known area), so signed-out people sign in first.
    if (!address) { login(); return; }
    setSubscribing(true);
    try { await subscribe(); } finally { setSubscribing(false); }
  }

  const subscribed = status === "subscribed";
  const blocked = status === "denied";
  const unsupported = status === "unsupported";
  const empty = activeDrops.length === 0;
  const canShow = !empty && nearest && onShowNearest;
  // With no drops anywhere, an upcoming event is the best thing to point at.
  const eventLead = empty && nextEvent ? nextEvent : null;

  // Three situations, three different first actions:
  //   nothing live anywhere      → get an alert when something drops
  //   live drops, all far away   → go look at the nearest one
  // Hiding a drop yourself is always offered, but second.
  const title = empty ? "No drops live right now" : `Nearest drop: ${formatKm(nearestM)} away`;
  const Icon = empty ? Radar : MapPin;

  const alertLabel = subscribed
    ? "Alerts on"
    : !address
      ? "Sign in for drop alerts"
      : "Alert me when one drops";

  const alertButton = !unsupported && !blocked && (
    <button
      type="button"
      onClick={handleNotify}
      disabled={subscribing || subscribed}
      aria-live="polite"
      className={`h-11 rounded-full text-sm/none flex items-center justify-center gap-2 whitespace-nowrap px-4
        motion-safe:transition-colors ${
        subscribed
          ? "bg-brand-soft text-brand cursor-default"
          : empty && !eventLead
            ? "bg-brand text-white hover:bg-brand/90 cursor-pointer disabled:opacity-70 disabled:cursor-wait"
            : "border border-line bg-white text-heading hover:bg-surface cursor-pointer disabled:opacity-60 disabled:cursor-wait"
      }`}
    >
      {subscribed
        ? <><Check className="w-4 h-4" strokeWidth={2} /> {alertLabel}</>
        : subscribing
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Turning on…</>
          : <><Bell className="w-4 h-4" strokeWidth={2} /> {alertLabel}</>}
    </button>
  );

  return (
    <div
      ref={cardRef}
      role="region"
      aria-label={title}
      className="modal-rise fixed left-1/2 -translate-x-1/2 w-[min(440px,calc(100vw-24px))] font-sans
        bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-5"
      style={{
        // Sit directly above the bottom nav rather than at a fixed 92px, which
        // on mobile put it underneath the nav's own shadow.
        bottom: "calc(var(--gd-nav-h, 0px) + 12px)",
        // Above the FABs (999) and the map controls (1000) — it's a prompt that
        // needs an answer, so nothing should overlap it. The others move aside
        // via --gd-cold-inset.
        zIndex: 1001,
      }}
    >
      <div className="flex items-center gap-3">
        <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center">
          <Icon className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <p className="flex-1 min-w-0 text-lg/[1.2] text-heading line-clamp-2">{title}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="w-8 h-8 shrink-0 rounded-full bg-surface text-nav-muted flex items-center justify-center
            cursor-pointer motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      <p className="text-sm/[140%] text-nav-muted mt-3">
        {eventLead ? (
          <>
            {eventLead.live ? "Happening now: " : "Coming up: "}
            <span className="text-heading">{eventLead.title}</span>
            {eventLead.live ? "" : `, ${eventLead.when}`} with <span className="text-heading">{eventLead.budget}</span> to find.
          </>
        ) : empty ? (
          subscribed
            ? <>You&apos;re set. We&apos;ll ping you the moment G$ is hidden near you. Drops land often around campuses, events and sponsor campaigns.</>
            : <>New drops land often around campuses, events and sponsor campaigns. Turn on alerts and we&apos;ll tell you the moment G$ is hidden near you.</>
        ) : (
          <>
            <span className="text-heading">{activeDrops.length}</span> drop{activeDrops.length !== 1 ? "s" : ""} holding{" "}
            <span className="text-heading">{formatG$(totalHiddenWei)} G$</span> {activeDrops.length !== 1 ? "are" : "is"} live, just not close to you yet.
            {!subscribed && " Turn on alerts to hear when one lands nearby."}
          </>
        )}
        {(blocked || unsupported) && (
          <span className="block mt-2 text-xs/[140%]">
            {blocked
              ? "Notifications are blocked for this site. Allow them in your browser settings to get drop alerts."
              : "To get drop alerts on iPhone, add GoodDrops to your Home Screen first (Share, then Add to Home Screen)."}
          </span>
        )}
      </p>

      {/* The first action spans the card; the rest share a row beneath it. */}
      <div className="grid grid-cols-2 gap-2.5 mt-4 [&>*:first-child]:col-span-2 [&>*:nth-child(2):last-child]:col-span-2">
        {eventLead && (
          <Link
            href={`/events/${eventLead.id}`}
            className="h-11 rounded-full bg-brand text-white text-sm/none cursor-pointer flex items-center justify-center gap-2
              motion-safe:transition-colors hover:bg-brand/90 whitespace-nowrap px-4"
          >
            <CalendarDays className="w-4 h-4" strokeWidth={2} /> {eventLead.live ? "Go to the event" : "See the event"}
          </Link>
        )}
        {canShow && (
          <button
            type="button"
            onClick={() => { onShowNearest!(nearest!.lat, nearest!.lng); setDismissed(true); }}
            className="h-11 rounded-full bg-brand text-white text-sm/none cursor-pointer flex items-center justify-center gap-2
              motion-safe:transition-colors hover:bg-brand/90 whitespace-nowrap px-4"
          >
            <Navigation className="w-4 h-4" strokeWidth={2} /> Show me the nearest
          </button>
        )}
        {alertButton}
        <button
          type="button"
          onClick={onDrop}
          className={`h-11 rounded-full text-sm/none cursor-pointer whitespace-nowrap px-4 motion-safe:transition-colors ${
            empty && (subscribed || blocked || unsupported)
              ? "bg-brand text-white hover:bg-brand/90"
              : "border border-line bg-white text-heading hover:bg-surface"
          }`}
        >
          Hide a drop here
        </button>
      </div>
    </div>
  );
}
