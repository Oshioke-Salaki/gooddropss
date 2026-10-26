"use client";
import { useMemo, useState, useEffect, useRef } from "react";
import { X, Bell, MapPin, Check, Loader2 } from "lucide-react";
import { haversineDistance, formatG$, gpsToDeg } from "@/lib/utils";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { DROP_STATUS, type Drop, type LatLng } from "@/types";

interface Props {
  drops:    Drop[];
  userLoc:  LatLng | null;
  loading:  boolean;
  onDrop:   () => void;
}

// If the nearest live drop is farther than this, treat the user as "unseeded".
const NEAR_THRESHOLD_M = 25_000; // 25 km

/**
 * Cold-start capture. When a hunter has no drops near them, we don't dead-end
 * on an empty map — we show worldwide proof-of-life, a "notify me here" hook,
 * and a prompt to seed the first local drop themselves.
 */
export function ColdStartCard({ drops, userLoc, loading, onDrop }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const { status, subscribe }     = usePushSubscription();
  const [subscribing, setSubscribing] = useState(false);

  const now = Math.floor(Date.now() / 1000);

  const { activeDrops, totalHiddenWei, nearestM } = useMemo(() => {
    const active = drops.filter((d) => d.status === DROP_STATUS.Active && d.expiry > now);
    const totalWei = active.reduce((s, d) => s + d.amount, 0n);
    let nearest = Infinity;
    if (userLoc) {
      for (const d of active) {
        const dist = haversineDistance(userLoc.lat, userLoc.lng, gpsToDeg(d.lat), gpsToDeg(d.lng));
        if (dist < nearest) nearest = dist;
      }
    }
    return { activeDrops: active, totalHiddenWei: totalWei, nearestM: nearest };
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
    setSubscribing(true);
    try { await subscribe(); } finally { setSubscribing(false); }
  }

  const subscribed = status === "subscribed";
  const notifyOff = subscribing || subscribed || status === "unsupported";

  return (
    <div
      ref={cardRef}
      role="region"
      aria-label={activeDrops.length === 0 ? "Be the first to drop" : "No drops near you yet"}
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
          <MapPin className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <p className="flex-1 min-w-0 text-lg/none text-heading truncate">
          {activeDrops.length === 0 ? "Be the first to drop" : "No drops near you yet"}
        </p>
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

      {/* Copy adapts: genuinely-empty vs. drops-exist-but-far */}
      <p className="text-sm/[140%] text-nav-muted mt-3">
        {activeDrops.length === 0 ? (
          <>Hide some G$ around your neighbourhood and start the treasure hunt where you live — your drop could be the one that pulls people onto the map here.</>
        ) : (
          <>
            GoodDrops is live — <span className="text-heading">{activeDrops.length}</span> drop{activeDrops.length !== 1 ? "s" : ""} holding{" "}
            <span className="text-heading">{formatG$(totalHiddenWei)} G$</span> hidden around the world right now. Be the first to bring the hunt to your area.
          </>
        )}
      </p>

      <div className="flex gap-2.5 mt-4">
        <button
          type="button"
          onClick={onDrop}
          className="flex-1 h-11 rounded-full bg-brand text-white text-sm/none cursor-pointer
            motion-safe:transition-colors hover:bg-brand/90 whitespace-nowrap"
        >
          Hide the first drop
        </button>
        <button
          type="button"
          onClick={handleNotify}
          disabled={notifyOff}
          aria-live="polite"
          className={`flex-1 h-11 rounded-full text-sm/none flex items-center justify-center gap-2 whitespace-nowrap
            motion-safe:transition-colors ${
            subscribed
              ? "bg-brand-soft text-brand cursor-default"
              : "border border-line bg-white text-heading hover:bg-surface cursor-pointer disabled:cursor-default disabled:opacity-60"
          }`}
        >
          {subscribed
            ? <><Check className="w-4 h-4" strokeWidth={2} /> Notifying</>
            : subscribing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Notify me</>
              : <><Bell className="w-4 h-4" strokeWidth={2} /> Notify me</>}
        </button>
      </div>
    </div>
  );
}
