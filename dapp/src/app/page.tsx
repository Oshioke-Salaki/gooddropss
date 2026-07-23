"use client";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { LandmarkCreator } from "@/components/LandmarkCreator";
import { LandmarkManageSheet } from "@/components/LandmarkManageSheet";
import { useLandmarks } from "@/hooks/useLandmarks";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { isAdminAddress } from "@/lib/admins";
import { CreateDropSheet } from "@/components/CreateDropSheet";
import { ChainDropCreator } from "@/components/ChainDropCreator";
import { ClaimSheet } from "@/components/ClaimSheet";
import { HuntingMode } from "@/components/HuntingMode";
import { ActivityTicker } from "@/components/ActivityTicker";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { PushPermissionBanner } from "@/components/PushPermissionBanner";
import { NearbyLocationReporter } from "@/components/NearbyLocationReporter";
import { ColdStartCard } from "@/components/ColdStartCard";
import { ShopSheet } from "@/components/ShopSheet";
import { useDropNotifications } from "@/hooks/useDropNotifications";
import { useDrops } from "@/hooks/useDrops";
import { useHiddenDrops } from "@/hooks/useHiddenDrops";
import { parseDropHint } from "@/lib/utils";
import type { Drop, LatLng, Spot, Landmark } from "@/types";
import { DROP_STATUS } from "@/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center bg-cream gap-3">
      <div className="text-4xl animate-bounce">📍</div>
      <p className="font-bold text-muted text-sm animate-pulse">Loading map…</p>
    </div>
  ),
});

export default function HomePage() {
  const { drops: allDrops, loading, fetchDrops, markClaimed } = useDrops();
  const hiddenDrops = useHiddenDrops();
  // Drop admins moderated away are removed everywhere in the UI, not just the map.
  const drops = useMemo(
    () => (hiddenDrops.size === 0 ? allDrops : allDrops.filter((d) => !hiddenDrops.has(d.id.toString()))),
    [allDrops, hiddenDrops],
  );
  useDropNotifications(drops); // fires browser notification when own drop is claimed
  const [selectedDrop, setSelectedDrop] = useState<Drop | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [showChain,  setShowChain]      = useState(false);
  const [huntingDrop, setHuntingDrop]   = useState<Drop | null>(null);
  const [userLoc, setUserLoc]           = useState<LatLng | null>(null);
  const [spots, setSpots]               = useState<Spot[]>([]);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);

  // Admin landmarks + crowdsourced suggestions
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);
  const { isVerified } = useIdentityStatus();
  // A verified (non-admin) human may SUGGEST a place; it goes to admin review.
  const canSuggest = !isAdmin && isVerified;
  const canPlaceLandmark = isAdmin || canSuggest;
  const landmarkMode = isAdmin ? "admin" : "suggest";
  const { landmarks, refresh: refreshLandmarks } = useLandmarks();
  const [placingLandmark, setPlacingLandmark] = useState(false);
  const [pickedCoord, setPickedCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [managingLandmark, setManagingLandmark] = useState<Landmark | null>(null);
  // Deep-link preview: /?focus=lat,lng centers the map on a place (from the admin
  // Places/Suggestions lists). Read once, then strip the param so a later manual
  // pan isn't yanked back on re-render.
  const [focusCoord, setFocusCoord] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const f = p.get("focus");
      if (!f) return;
      const [la, ln] = f.split(",").map(Number);
      if (Number.isFinite(la) && Number.isFinite(ln)) setFocusCoord({ lat: la, lng: ln });
      p.delete("focus");
      const qs = p.toString();
      window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
    } catch { /* ignore malformed params */ }
  }, []);

  useEffect(() => {
    fetchDrops();
  }, [fetchDrops]);

  // GoodSpots — merchants that accept G$ nearby
  useEffect(() => {
    fetch("/api/spots")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.spots)) setSpots(d.spots); })
      .catch(() => {});
  }, []);

  const handleDropClick = useCallback((drop: Drop) => {
    setSelectedDrop(drop);
  }, []);

  const handleSpotClick = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
  }, []);

  const handleUserLocation = useCallback((loc: LatLng) => {
    setUserLoc(loc);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <Nav />

      {/* Full-screen map — starts below header, ends above bottom nav on mobile */}
      <div className="absolute top-14 left-0 right-0 bottom-16 sm:bottom-0">
        <MapView
          drops={drops.filter((d) => {
            // Must go through parseDropHint, not a startsWith: a riddle-locked
            // private drop is "[R][P:…]", which no prefix test would catch.
            if (parseDropHint(d.hint).isPrivate) return false;
            // Only LIVE drops belong on the map. Claimed/reclaimed pins just add
            // noise and tease hunters with money that's already gone — drop them
            // the moment they're no longer claimable (also hides expired ones).
            return d.status === DROP_STATUS.Active && d.expiry > Math.floor(Date.now() / 1000);
          })}
          onDropClick={handleDropClick}
          userLocation={userLoc}
          onUserLocation={handleUserLocation}
          spots={spots}
          onSpotClick={handleSpotClick}
          landmarks={landmarks}
          focus={focusCoord}
          interactiveLandmarks={isAdmin && !placingLandmark}
          onLandmarkClick={(lm) => setManagingLandmark(lm)}
          pickingMode={placingLandmark}
          onMapPick={(lat, lng) => { setPickedCoord({ lat, lng }); setPlacingLandmark(false); }}
        />
      </div>

      {/* Status badge — hidden while placing a landmark, so the placement
          instruction banner owns the centered top slot (they'd otherwise overlap). */}
      {!placingLandmark && (
      <div
        style={{
          position: "fixed",
          // Header is 56px; the verification banner sits directly under it and
          // wraps to two lines on mobile, so clear whatever height it reports.
          top: "calc(70px + var(--gd-banner-h, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 999,
          fontFamily: "inherit",
          pointerEvents: "none",
          transition: "top 0.2s ease",
        }}
      >
        {loading && (
          <div className="bg-cream border-2 border-ink rounded-full px-4 py-1.5 text-xs font-bold shadow-brutal-sm animate-pulse whitespace-nowrap">
            Loading drops…
          </div>
        )}
        {!loading && drops.length === 0 && (
          <div className="bg-cream border-2 border-ink rounded-full px-4 py-1.5 text-xs font-bold shadow-brutal-sm whitespace-nowrap">
            No drops yet — be the first! 💰
          </div>
        )}
        {!loading && drops.length > 0 && (
          <div className="bg-lime border-2 border-ink rounded-full px-4 py-1.5 text-xs font-black shadow-brutal-sm whitespace-nowrap">
            {drops.filter((d) => d.status === 0 && d.expiry > Math.floor(Date.now() / 1000)).length} drops live
          </div>
        )}
      </div>
      )}

      {/* Action buttons — fixed so Leaflet's stacking context can't bury them */}
      <div
        className="map-actions"
        style={{
          position: "fixed",
          // Lift clear of the cold-start sheet when it's up; --gd-cold-inset is 0 otherwise.
          bottom: "calc(96px + var(--gd-cold-inset, 0px))",
          right: "20px", zIndex: 999,
          display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-end",
          transition: "bottom 0.2s ease",
        }}
      >
        {!placingLandmark && (<>
        {/* Admin: name a place · Verified hunter: suggest a place (→ review) */}
        {canPlaceLandmark && (
          <button
            onClick={() => { setPickedCoord(null); setPlacingLandmark(true); }}
            style={{
              background: "#181818",
              color: "#BFFD00",
              border: "2.5px solid #111111",
              boxShadow: "3px 3px 0 #111111",
              fontWeight: 800, fontSize: "12px",
              padding: "9px 14px", borderRadius: "12px",
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <span>🏷️</span><span>{isAdmin ? "Name place" : "Suggest place"}</span>
          </button>
        )}
        {/* Hunt Chain FAB */}
        <button
          onClick={() => setShowChain(true)}
          style={{
            background: "#111111", color: "#BFFD00",
            border: "2.5px solid #111111",
            boxShadow: "3px 3px 0 #BFFD00",
            fontWeight: 800, fontSize: "13px",
            padding: "10px 16px", borderRadius: "14px",
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: "6px",
            transition: "box-shadow 0.1s, transform 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "1px 1px 0 #BFFD00"; e.currentTarget.style.transform = "translate(2px,2px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "3px 3px 0 #BFFD00"; e.currentTarget.style.transform = "translate(0,0)"; }}
        >
          <span>Drop Chain</span>
          <span>🔗</span>
        </button>
        {/* Drop G$ FAB */}
        <button
          onClick={() => setShowCreate(true)}
          style={{
            background: "#bffd00", color: "#111111",
            border: "2.5px solid #111111",
            boxShadow: "3px 3px 0 #111111",
            fontWeight: 800, fontSize: "15px",
            padding: "12px 20px", borderRadius: "16px",
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: "8px",
            transition: "box-shadow 0.1s, transform 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "1px 1px 0 #111111"; e.currentTarget.style.transform = "translate(2px,2px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "3px 3px 0 #111111"; e.currentTarget.style.transform = "translate(0,0)"; }}
        >
          <span>Drop G$</span>
          <span>💰</span>
        </button>
        </>)}
      </div>

      <BottomNav />
      <ActivityTicker />
      <PushPermissionBanner />
      <NearbyLocationReporter userLoc={userLoc} />
      <OnboardingOverlay />

      {/* Cold-start capture — shows worldwide proof-of-life + notify/seed CTAs
          when the hunter has no drops near them. */}
      <ColdStartCard
        drops={drops}
        userLoc={userLoc}
        loading={loading}
        onDrop={() => setShowCreate(true)}
      />

      {/* Hunting mode — full screen immersive overlay */}
      {huntingDrop && (
        <HuntingMode
          drop={huntingDrop}
          userLocation={userLoc}
          onClose={() => setHuntingDrop(null)}
          onSuccess={() => { setHuntingDrop(null); fetchDrops(); }}
        />
      )}

      <CreateDropSheet
        open={showCreate}
        userLocation={userLoc}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); fetchDrops(); }}
      />

      <ChainDropCreator
        open={showChain}
        userLocation={userLoc}
        onClose={() => setShowChain(false)}
        onSuccess={() => { setShowChain(false); fetchDrops(); }}
      />

      <ClaimSheet
        drop={selectedDrop}
        userLocation={userLoc}
        onClose={() => setSelectedDrop(null)}
        onSuccess={() => { if (selectedDrop) markClaimed(selectedDrop.id); setSelectedDrop(null); }}
        onHunt={(drop) => { setSelectedDrop(null); setHuntingDrop(drop); }}
      />

      {/* GoodSpots — proximity-gated G$ checkout at merchant locations */}
      <ShopSheet
        spot={selectedSpot}
        userLocation={userLoc}
        onClose={() => setSelectedSpot(null)}
      />

      {/* Admin names a place (goes live); verified hunter suggests one (→ review) */}
      {canPlaceLandmark && (
        <LandmarkCreator
          placing={placingLandmark}
          picked={pickedCoord}
          landmarks={landmarks}
          mode={landmarkMode}
          onCancel={() => { setPlacingLandmark(false); setPickedCoord(null); }}
          onRepick={() => { setPickedCoord(null); setPlacingLandmark(true); }}
          onCreated={() => { setPickedCoord(null); setPlacingLandmark(false); refreshLandmarks(); }}
        />
      )}

      {/* Admin: tap a place on the map to edit / hide / delete it inline */}
      {isAdmin && (
        <LandmarkManageSheet
          landmark={managingLandmark}
          onClose={() => setManagingLandmark(null)}
          onChanged={() => refreshLandmarks()}
        />
      )}
    </div>
  );
}
