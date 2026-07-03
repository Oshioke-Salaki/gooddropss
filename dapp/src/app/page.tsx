"use client";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { Nav, BottomNav } from "@/components/Nav";
import { CreateDropSheet } from "@/components/CreateDropSheet";
import { ChainDropCreator } from "@/components/ChainDropCreator";
import { ClaimSheet } from "@/components/ClaimSheet";
import { HuntingMode } from "@/components/HuntingMode";
import { ActivityTicker } from "@/components/ActivityTicker";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { PushPermissionBanner } from "@/components/PushPermissionBanner";
import { ColdStartCard } from "@/components/ColdStartCard";
import { useDropNotifications } from "@/hooks/useDropNotifications";
import { useDrops } from "@/hooks/useDrops";
import type { Drop, LatLng } from "@/types";
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

  useEffect(() => {
    fetchDrops();
  }, [fetchDrops]);

  const handleDropClick = useCallback((drop: Drop) => {
    setSelectedDrop(drop);
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
            if (d.hint.startsWith("[P:")) return false;
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
        />
      </div>

      {/* Status badge — fixed so it clears the Leaflet stacking context */}
      <div
        style={{
          position: "fixed",
          top: "108px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 999,
          fontFamily: "inherit",
          pointerEvents: "none",
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

      {/* Action buttons — fixed so Leaflet's stacking context can't bury them */}
      <div className="map-actions" style={{ position: "fixed", bottom: "96px", right: "20px", zIndex: 999, display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-end" }}>
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
    </div>
  );
}
