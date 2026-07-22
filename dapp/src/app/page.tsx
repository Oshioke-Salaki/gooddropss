"use client";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { LandmarkCreator } from "@/components/LandmarkCreator";
import { useLandmarks } from "@/hooks/useLandmarks";
import { isAdminAddress } from "@/lib/admins";
import { CreateDropSheet } from "@/components/CreateDropSheet";
import { ChainDropCreator } from "@/components/ChainDropCreator";
import { ClaimSheet } from "@/components/ClaimSheet";
import { HuntingMode } from "@/components/HuntingMode";
import { ActivityTicker } from "@/components/ActivityTicker";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { PushPermissionBanner } from "@/components/PushPermissionBanner";
import { ColdStartCard } from "@/components/ColdStartCard";
import { ShopSheet } from "@/components/ShopSheet";
import { useDropNotifications } from "@/hooks/useDropNotifications";
import { useDrops } from "@/hooks/useDrops";
import { parseDropHint } from "@/lib/utils";
import type { Drop, LatLng, Spot } from "@/types";
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
  const { drops, loading, fetchDrops, markClaimed } = useDrops();
  useDropNotifications(drops); // fires browser notification when own drop is claimed
  const [selectedDrop, setSelectedDrop] = useState<Drop | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [showChain,  setShowChain]      = useState(false);
  const [huntingDrop, setHuntingDrop]   = useState<Drop | null>(null);
  const [userLoc, setUserLoc]           = useState<LatLng | null>(null);
  const [spots, setSpots]               = useState<Spot[]>([]);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);

  // Admin landmarks
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);
  const { landmarks, refresh: refreshLandmarks } = useLandmarks();
  const [placingLandmark, setPlacingLandmark] = useState(false);
  const [pickedCoord, setPickedCoord] = useState<{ lat: number; lng: number } | null>(null);

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
            if (d.status === DROP_STATUS.Active) return true;
            const now = Math.floor(Date.now() / 1000);
            const cutoff = now - 24 * 60 * 60;
            // claimed drops: use claimedAt; expired/reclaimed drops: use expiry
            if (d.claimedAt > 0) return d.claimedAt > cutoff;
            return d.expiry > cutoff;
          })}
          onDropClick={handleDropClick}
          userLocation={userLoc}
          onUserLocation={handleUserLocation}
          spots={spots}
          onSpotClick={handleSpotClick}
          landmarks={landmarks}
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
        {/* Admin: name a place */}
        {isAdmin && (
          <button
            onClick={() => { setPickedCoord(null); setPlacingLandmark(true); }}
            style={{
              background: placingLandmark ? "#BFFD00" : "#181818",
              color: placingLandmark ? "#111" : "#BFFD00",
              border: "2.5px solid #111111",
              boxShadow: "3px 3px 0 #111111",
              fontWeight: 800, fontSize: "12px",
              padding: "9px 14px", borderRadius: "12px",
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <span>🏷️</span><span>{placingLandmark ? "Tap the map…" : "Name place"}</span>
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

      {/* Admin: name/label a place on the map */}
      {isAdmin && (
        <LandmarkCreator
          placing={placingLandmark}
          picked={pickedCoord}
          landmarks={landmarks}
          onCancel={() => { setPlacingLandmark(false); setPickedCoord(null); }}
          onRepick={() => { setPickedCoord(null); setPlacingLandmark(true); }}
          onCreated={() => { setPickedCoord(null); setPlacingLandmark(false); refreshLandmarks(); }}
        />
      )}
    </div>
  );
}
