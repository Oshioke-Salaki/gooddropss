"use client";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { ClaimSheet } from "@/components/ClaimSheet";
import { ActivityTicker } from "@/components/ActivityTicker";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { PushPermissionBanner } from "@/components/PushPermissionBanner";
import { NearbyLocationReporter } from "@/components/NearbyLocationReporter";
import { ColdStartCard } from "@/components/ColdStartCard";
import { WelcomeChestCard } from "@/components/WelcomeChestCard";
import { useWelcomeChest } from "@/hooks/useWelcomeChest";
import type { WelcomeView } from "@/lib/welcome";
import { ShopSheet } from "@/components/ShopSheet";
import { useDropNotifications } from "@/hooks/useDropNotifications";
import { useLiveDrops } from "@/hooks/useLiveDrops";
import { useHiddenDrops } from "@/hooks/useHiddenDrops";
import { parseDropHint } from "@/lib/utils";
import type { Drop, LatLng, Spot, Landmark } from "@/types";
import type { MapEventPin } from "@/components/MapView";
import type { GdEvent } from "@/lib/events";
import { useRouter } from "next/navigation";
import { DROP_STATUS } from "@/types";

// Opened by a tap, so not part of the first load; warmed once the map settles.
const loadDropG = () => import("@/components/drop/DropGDrawer");
const loadChain = () => import("@/components/ChainDropCreator");
const loadHunt = () => import("@/components/HuntingMode");
const DropGDrawer = dynamic(() => loadDropG().then((m) => m.DropGDrawer), { ssr: false });
const ChainDropCreator = dynamic(() => loadChain().then((m) => m.ChainDropCreator), { ssr: false });
const HuntingMode = dynamic(() => loadHunt().then((m) => m.HuntingMode), { ssr: false });

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
  const { drops: allDrops, loading, fetchDrops, markClaimed } = useLiveDrops();
  const hiddenDrops = useHiddenDrops();
  // Drop admins moderated away are removed everywhere in the UI, not just the map.
  const drops = useMemo(
    () => (hiddenDrops.size === 0 ? allDrops : allDrops.filter((d) => !hiddenDrops.has(d.id.toString()))),
    [allDrops, hiddenDrops],
  );
  useDropNotifications(); // fires a browser notification when one of your drops is claimed

  // Demand heatmap: where hunters have CLAIMED drops. Shows droppers where the
  // players are, so drops land where they'll be found. Off by default, and its
  // points are only fetched the first time it's switched on — the map itself
  // only ever loads live drops.
  // No toggle in the UI yet; flip this (or wire a control to it) to bring it back.
  const [showHeatmap] = useState(false);
  const [heatmapPoints, setHeatmapPoints] = useState<{ lat: number; lng: number }[]>([]);
  useEffect(() => {
    if (!showHeatmap || heatmapPoints.length > 0) return;
    let alive = true;
    fetch("/api/drops/heat")
      .then((r) => r.json())
      .then((d: { points?: [number, number][] }) => {
        if (alive && Array.isArray(d.points)) setHeatmapPoints(d.points.map(([lat, lng]) => ({ lat, lng })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [showHeatmap, heatmapPoints.length]);
  const [selectedDrop, setSelectedDrop] = useState<Drop | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [showChain,  setShowChain]      = useState(false);
  const [huntingDrop, setHuntingDrop]   = useState<Drop | null>(null);
  const [userLoc, setUserLoc]           = useState<LatLng | null>(null);
  const [spots, setSpots]               = useState<Spot[]>([]);
  const eventPins = useMapEvents();
  const router = useRouter();
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);

  // Admin landmarks + crowdsourced suggestions
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);
  const { isVerified } = useIdentityStatus();
  // Welcome chest: a new player's first win, hidden a short walk away.
  const welcome = useWelcomeChest(address);
  const [welcomeUp, setWelcomeUp] = useState(false);
  const [chestHunt, setChestHunt] = useState<Extract<WelcomeView, { state: "live" }> | null>(null);
  const chestDrop = useMemo<Drop | null>(() => chestHunt ? {
    id: BigInt(chestHunt.dropId),
    dropper: "0x0000000000000000000000000000000000000000",
    claimer: "0x0000000000000000000000000000000000000000",
    amount: BigInt(chestHunt.amountG) * 10n ** 18n,
    expiry: chestHunt.expiry, claimedAt: 0, createdAt: 0, status: DROP_STATUS.Active,
    lat: 0, lng: 0, hint: "",
  } : null, [chestHunt]);
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
  // "Hide my first drop" (and anything else) can ask for the drop drawer: by
  // event while on the map, or by /?drop=1 from another page.
  useEffect(() => {
    const open = () => setShowCreate(true);
    window.addEventListener("gd:open-drop", open);
    return () => window.removeEventListener("gd:open-drop", open);
  }, []);
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
      const dropNow = p.get("drop") === "1";
      if (dropNow) setShowCreate(true);
      if (!f && !s && !dropNow) return;
      p.delete("focus"); p.delete("spot"); p.delete("drop");
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

  // From a shop reward's sheet to that shop's pay sheet (the reward's chest sits
  // on the shop's pin, so the pin itself can't be tapped). Same path as a
  // ?spot= deep link: the loaded list first, else fetched by id.
  const openShop = useCallback((spotId: string) => {
    setSelectedDrop(null);
    setSpotDeepLinkId(spotId);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void loadDropG(); void loadChain(); void loadHunt(); }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  // GPS fires about once a second while walking. Moves under ~5 m don't change
  // anything on screen, so they don't re-render the page (and the map's markers).
  const lastLoc = useRef<LatLng | null>(null);
  const handleUserLocation = useCallback((loc: LatLng) => {
    const prev = lastLoc.current;
    if (prev) {
      const dLat = (loc.lat - prev.lat) * 111_320;
      const dLng = (loc.lng - prev.lng) * 111_320 * Math.cos((loc.lat * Math.PI) / 180);
      if (dLat * dLat + dLng * dLng < 25) return;
    }
    lastLoc.current = loc;
    setUserLoc(loc);
  }, []);

  // Only live, public drops go on the map. Recomputed when the drops change or a
  // minute passes (expiry), not on every render, so the map keeps its markers.
  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const mapDrops = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return drops.filter((d) => {
      // Must go through parseDropHint, not a startsWith: a riddle-locked
      // private drop is "[R][P:…]", which no prefix test would catch.
      if (parseDropHint(d.hint).isPrivate) return false;
      // Claimed, reclaimed and expired pins only tease hunters with money that's gone.
      return d.status === DROP_STATUS.Active && d.expiry > now;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drops, minuteTick]);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <Nav />

      {/* Full-screen map — starts below header, ends above bottom nav on mobile */}
      <div className="absolute top-nav left-0 right-0 bottom-0">
        <MapView
          drops={mapDrops}
          onDropClick={handleDropClick}
          userLocation={userLoc}
          onUserLocation={handleUserLocation}
          spots={spots}
          events={eventPins}
          onEventClick={(id) => router.push(`/events/${id}`)}
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
      <WelcomeChestCard
        view={welcome.view}
        userLoc={userLoc}
        hiding={welcome.hiding}
        error={welcome.error}
        onHide={() => { void welcome.hide(userLoc); }}
        onHunt={(v) => setChestHunt(v)}
        onVisibleChange={setWelcomeUp}
      />

      {/* The welcome card takes this slot while it's up; the two never stack. */}
      {!welcomeUp && <ColdStartCard
        drops={drops}
        userLoc={userLoc}
        loading={loading}
        onDrop={() => setShowCreate(true)}
        onShowNearest={(lat, lng) => setFocusCoord({ lat, lng })}
        nextEvent={eventPins[0] ?? null}
      />}

      {/* Welcome chest hunt: the radar, with the amount kept a surprise */}
      {chestHunt && chestDrop && (
        <HuntingMode
          drop={chestDrop}
          dropCoords={{ lat: chestHunt.lat, lng: chestHunt.lng }}
          userLocation={userLoc}
          onClose={() => setChestHunt(null)}
          onSuccess={() => { welcome.markOpened(); setChestHunt(null); checkBadgesAfterClaim(address); }}
          chest={{ onPassItOn: () => { welcome.markOpened(); setChestHunt(null); checkBadgesAfterClaim(address); setShowCreate(true); } }}
        />
      )}

      {/* Hunting mode — full screen immersive overlay */}
      {huntingDrop && (
        <HuntingMode
          drop={huntingDrop}
          userLocation={userLoc}
          onClose={() => setHuntingDrop(null)}
          onHandOff={() => { const d = huntingDrop; setHuntingDrop(null); setSelectedDrop(d); }}
          onSuccess={() => { markClaimed(huntingDrop.id); setHuntingDrop(null); fetchDrops(); checkBadgesAfterClaim(address); }}
        />
      )}

      {showCreate && (
      <DropGDrawer
        userLocation={userLoc}
        claimPoints={heatmapPoints}
        onClose={() => setShowCreate(false)}
        onSuccess={fetchDrops}
        onViewOnMap={(lat, lng) => setFocusCoord({ lat, lng })}
      />
      )}

      {showChain && <ChainDropCreator
        open={showChain}
        userLocation={userLoc}
        onClose={() => setShowChain(false)}
        onSuccess={() => { setShowChain(false); fetchDrops(); }}
      />}

      <ClaimSheet
        drop={selectedDrop}
        userLocation={userLoc}
        onClose={() => setSelectedDrop(null)}
        onSuccess={() => { if (selectedDrop) markClaimed(selectedDrop.id); setSelectedDrop(null); checkBadgesAfterClaim(address); }}
        onHunt={(drop) => { setSelectedDrop(null); setHuntingDrop(drop); }}
        onOpenShop={openShop}
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

// ── Events on the map ─────────────────────────────────────────────────────────
// Live events and those starting within a week. Refreshed every couple of
// minutes so a starting event flips to "Live" without a reload. Any failure
// just means no event pins — the map itself is never affected.
const EVENT_HORIZON_S = 7 * 86_400;

function pinWhen(startsAt: number, now: number): string {
  const d = new Date(startsAt * 1000);
  const time = d.toLocaleTimeString("en", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });
  const today = new Date(now * 1000);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return d.getHours() >= 17 ? `Tonight ${time}` : `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString("en", { weekday: "short" })} ${time}`;
}

function useMapEvents(): MapEventPin[] {
  const [pins, setPins] = useState<MapEventPin[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/events")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { live?: { event: GdEvent }[]; upcoming?: { event: GdEvent }[] } | null) => {
          if (!alive || !d) return;
          const now = Math.floor(Date.now() / 1000);
          const toPin = (e: GdEvent, live: boolean): MapEventPin => ({
            id: e.id, title: e.title, lat: e.lat, lng: e.lng, live,
            when: pinWhen(e.startsAt, now), budget: `${e.budgetG.toLocaleString("en")} G$`,
          });
          setPins([
            ...(d.live ?? []).map((r) => toPin(r.event, true)),
            ...(d.upcoming ?? []).filter((r) => r.event.startsAt - now <= EVENT_HORIZON_S).map((r) => toPin(r.event, false)),
          ]);
        })
        .catch(() => {});
    load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 120_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  return pins;
}

