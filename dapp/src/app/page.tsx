"use client";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { Nav } from "@/components/Nav";
import { LandmarkCreator } from "@/components/LandmarkCreator";
import { checkBadgesAfterClaim } from "@/components/BadgeCelebration";
import { LandmarkManageSheet } from "@/components/LandmarkManageSheet";
import { MapSearchBar } from "@/components/MapSearchBar";
import { MapActionButtons } from "@/components/MapActionButtons";
import { useLandmarks } from "@/hooks/useLandmarks";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { isAdminAddress } from "@/lib/admins";
import { DropGDrawer } from "@/components/drop/DropGDrawer";
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
import { parseDropHint, gpsToDeg } from "@/lib/utils";
import type { Drop, LatLng, Spot, Landmark } from "@/types";
import { DROP_STATUS } from "@/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center bg-surface gap-3 font-sans">
      <MapPin className="w-8 h-8 text-brand motion-safe:animate-bounce" strokeWidth={1.75} />
      <p className="text-sm/none text-nav-muted animate-pulse">Loading map…</p>
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

  // Demand heatmap: where hunters have CLAIMED drops (public, from the subgraph
  // data already loaded). Shows droppers where the players are, so drops land
  // where they'll be found. Toggled off by default.
  const [showHeatmap, setShowHeatmap] = useState(false);
  const heatmapPoints = useMemo(
    () => allDrops
      .filter((d) => d.status === DROP_STATUS.Claimed)
      .map((d) => ({ lat: gpsToDeg(d.lat), lng: gpsToDeg(d.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)),
    [allDrops],
  );
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
  // The mobile nav rail hangs over the search band; Nav broadcasts its state so we
  // pull the band rather than leave a sliver of it showing beneath the rail.
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  useEffect(() => {
    const onMenu = (e: Event) => setNavMenuOpen(!!(e as CustomEvent).detail?.open);
    window.addEventListener("gd:navmenu", onMenu);
    return () => window.removeEventListener("gd:navmenu", onMenu);
  }, []);
  // Deep-link a shop's pay sheet: /?spot=<id> (the merchant's pay-here QR poster).
  const [spotDeepLinkId, setSpotDeepLinkId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const f = p.get("focus");
      const s = p.get("spot");
      if (f) {
        const [la, ln] = f.split(",").map(Number);
        if (Number.isFinite(la) && Number.isFinite(ln)) setFocusCoord({ lat: la, lng: ln });
      }
      if (s) setSpotDeepLinkId(s);
      if (!f && !s) return;
      p.delete("focus"); p.delete("spot");
      const qs = p.toString();
      window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
    } catch { /* ignore malformed params */ }
  }, []);

  // Once spots load, open the deep-linked shop's pay sheet. Fetch it directly if
  // it isn't in the public (active-only) list — e.g. the poster of a paused shop.
  useEffect(() => {
    if (!spotDeepLinkId) return;
    const found = spots.find((s) => s.id === spotDeepLinkId);
    if (found) { setSelectedSpot(found); setSpotDeepLinkId(null); return; }
    fetch(`/api/spots?id=${encodeURIComponent(spotDeepLinkId)}`)
      .then((r) => r.json())
      .then((d) => { if (d.spot) setSelectedSpot(d.spot); })
      .catch(() => {})
      .finally(() => setSpotDeepLinkId(null));
  }, [spotDeepLinkId, spots]);

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
      <div className="absolute top-nav left-0 right-0 bottom-0">
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
          heatmapPoints={heatmapPoints}
          showHeatmap={showHeatmap}
          focus={focusCoord}
          interactiveLandmarks={isAdmin && !placingLandmark}
          onLandmarkClick={(lm) => setManagingLandmark(lm)}
          pickingMode={placingLandmark}
          onMapPick={(lat, lng) => { setPickedCoord({ lat, lng }); setPlacingLandmark(false); }}
        />
      </div>

      {/* Location search. Below lg it's a full-bleed band flush under the nav; at lg
          and up a floating card over the map's top-left. Hidden while placing a
          landmark (it would steal taps meant for the map) and while the mobile nav
          rail is open (the rail covers this slot). Sits under the nav (z-1100) but
          above every map control. */}
      {!placingLandmark && !navMenuOpen && (
        <div
          className="fixed left-0 right-0 lg:right-auto z-[900] lg:pt-4 lg:pl-[60px]"
          style={{ top: "calc(var(--spacing-nav) + var(--gd-banner-h, 0px))", transition: "top 0.2s ease" }}
        >
          <MapSearchBar
            landmarks={landmarks}
            onSelect={(lm) => setFocusCoord({ lat: lm.lat, lng: lm.lng })}
          />
        </div>
      )}

      {/* Action buttons — fixed so the map's stacking context can't bury them */}
      <div
        className="map-actions fixed z-[999] right-5 lg:right-[60px]
          bottom-[calc(20px+var(--gd-cold-inset,0px))] lg:bottom-[calc(60px+var(--gd-cold-inset,0px))] transition-[bottom] duration-200"
      >
        {!placingLandmark && (
          <MapActionButtons
            onDropG={() => setShowCreate(true)}
            onDropChain={() => setShowChain(true)}
            onNamePlace={canPlaceLandmark
              ? () => { setPickedCoord(null); setPlacingLandmark(true); }
              : undefined}
            namePlaceLabel={isAdmin ? "Name place" : "Suggest place"}
          />
        )}
      </div>

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
          onSuccess={() => { setHuntingDrop(null); fetchDrops(); checkBadgesAfterClaim(address); }}
        />
      )}

      {showCreate && (
      <DropGDrawer
        userLocation={userLoc}
        claimPoints={heatmapPoints}
        onClose={() => setShowCreate(false)}
        onSuccess={fetchDrops}
      />
      )}

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
        onSuccess={() => { if (selectedDrop) markClaimed(selectedDrop.id); setSelectedDrop(null); checkBadgesAfterClaim(address); }}
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
