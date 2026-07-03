"use client";
import { useMemo, useState } from "react";
import { X, Bell, MapPin, Check } from "lucide-react";
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
  if (dismissed || !isUnseeded) return null;

  async function handleNotify() {
    setSubscribing(true);
    try { await subscribe(); } finally { setSubscribing(false); }
  }

  const subscribed = status === "subscribed";

  return (
    <div
      style={{
        position: "fixed", left: "50%", bottom: 92,
        transform: "translateX(-50%)",
        width: "min(440px, calc(100vw - 32px))",
        zIndex: 998,
        background: "#111", color: "#fff",
        border: "2px solid #111", borderRadius: 20,
        boxShadow: "4px 4px 0 #BFFD00",
        padding: "18px 18px 16px",
        fontFamily: "inherit",
      }}
    >
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          position: "absolute", top: 12, right: 12,
          width: 28, height: 28, borderRadius: "50%",
          background: "rgba(255,255,255,0.08)", border: "none",
          color: "#888", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <X size={15} />
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <MapPin size={18} color="#BFFD00" />
        <p style={{ margin: 0, fontWeight: 900, fontSize: 16 }}>
          {activeDrops.length === 0 ? "Be the first to drop" : "No drops near you yet"}
        </p>
      </div>

      {/* Copy adapts: genuinely-empty vs. drops-exist-but-far */}
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#aaa", lineHeight: 1.5 }}>
        {activeDrops.length === 0 ? (
          <>Hide some G$ around your neighbourhood and start the treasure hunt where you live — your drop could be the one that pulls people onto the map here.</>
        ) : (
          <>GoodDrops is live — <b style={{ color: "#BFFD00" }}>{activeDrops.length}</b> drop{activeDrops.length !== 1 ? "s" : ""} holding{" "}
          <b style={{ color: "#BFFD00" }}>{formatG$(totalHiddenWei)} G$</b> hidden around the world right now. Be the first to bring the hunt to your area.</>
        )}
      </p>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onDrop}
          style={{
            flex: 1, background: "#BFFD00", color: "#111",
            border: "2px solid #BFFD00", borderRadius: 12,
            padding: "12px", fontWeight: 900, fontSize: 14,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          💰 Hide the first drop
        </button>
        <button
          onClick={handleNotify}
          disabled={subscribing || subscribed || status === "unsupported"}
          style={{
            flex: 1, background: "transparent", color: subscribed ? "#BFFD00" : "#fff",
            border: "2px solid rgba(255,255,255,0.25)", borderRadius: 12,
            padding: "12px", fontWeight: 800, fontSize: 13,
            cursor: subscribed || status === "unsupported" ? "default" : "pointer",
            fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {subscribed ? <><Check size={15} /> Notifying</>
            : <><Bell size={15} /> {subscribing ? "…" : "Notify me"}</>}
        </button>
      </div>
    </div>
  );
}
