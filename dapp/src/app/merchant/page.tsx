"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  Store, MapPin, Check, UtensilsCrossed, ShoppingBag, Wrench, Bus, Camera,
  Megaphone, ArrowRight, Loader2, Plus, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import type { Spot } from "@/types";
import { MerchantSpotCard } from "@/components/merchant/MerchantSpotCard";
import { TaskScanner } from "@/components/merchant/TaskScanner";
import { HowRewardsWork } from "@/components/merchant/HowRewardsWork";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { useLandmarks } from "@/hooks/useLandmarks";
import { isSpotActive } from "@/lib/spotStatus";
import { getPositionRobust } from "@/lib/geolocate";

const CATEGORIES: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "food",      label: "Food & Drink", Icon: UtensilsCrossed },
  { id: "retail",    label: "Retail",       Icon: ShoppingBag },
  { id: "services",  label: "Services",     Icon: Wrench },
  { id: "transport", label: "Transport",    Icon: Bus },
  { id: "other",     label: "Other",        Icon: Store },
];

const INPUT =
  "w-full h-14 rounded-full bg-surface px-5 text-base/none text-heading placeholder:text-nav-muted " +
  "border border-transparent outline-none motion-safe:transition-colors focus:border-brand disabled:opacity-60";

const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A]";

export default function MerchantPage() {
  const { address, isConnected } = useSignedInAccount();
  const { login, ready } = useAuth();
  const { landmarks } = useLandmarks();

  const [mySpots, setMySpots]   = useState<Spot[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Form state
  const [name, setName]           = useState("");
  const [description, setDesc]    = useState("");
  const [category, setCategory]   = useState("food");
  const [discount, setDiscount]   = useState("");
  const [wallet, setWallet]       = useState("");
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [myLoc, setMyLoc]         = useState<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg]       = useState("");
  const [done, setDone]           = useState(false);

  const fetchMySpots = useCallback(() => {
    if (!address) { setMySpots([]); setLoading(false); return; }
    setLoading(true);
    // no-store: a merchant must always see the live status of their own shop.
    // A cached "active" response is exactly what made a paused spot still show
    // "Live" and then reject the next pause ("Only a live business can be paused").
    fetch(`/api/spots?owner=${address}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMySpots(Array.isArray(d.spots) ? d.spots : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => { fetchMySpots(); }, [fetchMySpots]);

  // Default payout wallet to the connected address
  useEffect(() => {
    if (address && !wallet) setWallet(address);
  }, [address, wallet]);

  // While the form is open, run a continuous high-accuracy watch — same as the
  // main map — so the position converges to a precise fix instead of a rough
  // one-shot. The picker follows this until the merchant drags, landing the pin
  // exactly on the shop. A quick seed fills the gap before the first watch fix.
  useEffect(() => {
    if (!showForm) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let alive = true;
    if (!myLoc) {
      getPositionRobust()
        .then((pos) => { if (alive) setMyLoc((cur) => cur ?? { lat: pos.coords.latitude, lng: pos.coords.longitude }); })
        .catch(() => {});
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { if (alive) setMyLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => { alive = false; navigator.geolocation.clearWatch(watchId); };
  }, [showForm]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    if (!address || !coords || submitting) return;
    setSubmitting(true);
    setErrMsg("");
    try {
      const res = await fetch("/api/spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, description, category, discount,
          wallet: wallet || address,
          ownerAddress: address,
          lat: coords.lat, lng: coords.lng,
          placeName,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not register spot");
      setDone(true);
      setShowForm(false);
      setName(""); setDesc(""); setDiscount(""); setCoords(null); setPlaceName(null);
      fetchMySpots();
      setTimeout(() => setDone(false), 4000);
    } catch (e: unknown) {
      setErrMsg((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim().length >= 2 && coords !== null && !submitting;
  const hasLiveSpot = mySpots.some(isSpotActive);

  const registerButton = (extra = "") => (
    <button
      type="button"
      onClick={() => { setShowForm(true); setErrMsg(""); }}
      className={`inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-brand text-white text-sm/none
        cursor-pointer motion-safe:transition-colors hover:bg-brand/90 whitespace-nowrap ${extra}`}
    >
      <Plus className="w-4 h-4" strokeWidth={2} /> Register a shop
    </button>
  );

  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-20">
          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="flex items-start lg:items-center justify-between gap-4 mb-6">
            <div className="min-w-0 flex flex-col gap-y-3">
              <h1 className="text-[32px]/none lg:text-4xl/none text-heading">Spots</h1>
              <p className="text-sm/[140%] text-nav-muted max-w-[560px]">
                Accept G$ at your shop. Hunters nearby see you on the map — payment only unlocks when they walk in.
              </p>
            </div>
            {isConnected && !showForm && registerButton("hidden lg:inline-flex shrink-0")}
          </div>

          {!ready ? (
            <div className="grid lg:grid-cols-[1fr_380px] gap-6 lg:gap-12 items-start">
              <Skeleton className="h-56 rounded-3xl bg-white" />
              <Skeleton className="h-40 rounded-3xl bg-white" />
            </div>
          ) : !isConnected ? (
            <div className={`${CARD} p-6 flex flex-col items-center text-center gap-y-4 mx-auto w-full max-w-[400px]`}>
              <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-heading">
                <Store className="w-6 h-6" strokeWidth={1.75} />
              </span>
              <p className="text-xl/none text-heading">Sign in to register your shop</p>
              <p className="text-sm/[140%] text-nav-muted">
                Takes under a minute. No hardware needed — your phone is the terminal.
              </p>
              <button
                type="button"
                onClick={login}
                className="mt-2 h-12 px-6 rounded-full bg-brand text-white text-base/none cursor-pointer
                  motion-safe:transition-colors hover:bg-brand/90"
              >
                Sign in
              </button>
            </div>
          ) : (
            <div className="grid lg:grid-cols-[1fr_380px] gap-6 lg:gap-12 items-start">
              {/* ── Main column ───────────────────────────────────────────── */}
              <div className="flex flex-col gap-y-6 min-w-0">
                {done && (
                  <div
                    role="status"
                    className="flex items-start gap-3 rounded-2xl bg-brand-soft px-4 py-3 text-sm/[140%] text-brand"
                  >
                    <Check className="w-4.5 h-4.5 shrink-0 mt-px" strokeWidth={2} />
                    <span>Submitted. An admin will review it — it goes live once approved.</span>
                  </div>
                )}

                {!showForm && registerButton("lg:hidden w-full h-12 text-base/none")}

                {/* ── Registration form ───────────────────────────────────── */}
                {showForm && (
                  <form
                    className={`${CARD} p-6 flex flex-col gap-y-5`}
                    onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="text-xl/none text-heading">New shop</h2>
                      <span className="text-sm/none text-nav-muted">Reviewed by an admin</span>
                    </div>

                    <label className="block">
                      <span className="block text-sm/none text-nav-muted mb-3">Shop name</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Mama Nkechi's Kitchen"
                        maxLength={60}
                        disabled={submitting}
                        className={INPUT}
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm/none text-nav-muted mb-3">Description</span>
                      <input
                        value={description}
                        onChange={(e) => setDesc(e.target.value)}
                        placeholder="Home-cooked meals, cold drinks"
                        maxLength={280}
                        disabled={submitting}
                        className={INPUT}
                      />
                    </label>

                    <div>
                      <span className="block text-sm/none text-nav-muted mb-3">Category</span>
                      <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-2">
                        {CATEGORIES.map((c) => {
                          const on = category === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              disabled={submitting}
                              onClick={() => setCategory(c.id)}
                              className={`inline-flex items-center gap-2 h-11 px-4 rounded-full text-sm/none cursor-pointer
                                motion-safe:transition-colors
                                ${on ? "bg-brand text-white" : "bg-surface text-heading hover:bg-nav-controls"}`}
                            >
                              <c.Icon className="w-4 h-4" strokeWidth={1.75} /> {c.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="block">
                      <span className="block text-sm/none text-nav-muted mb-3">G$ offer (optional)</span>
                      <input
                        value={discount}
                        onChange={(e) => setDiscount(e.target.value)}
                        placeholder="10% off when you pay with G$"
                        maxLength={80}
                        disabled={submitting}
                        className={INPUT}
                      />
                    </label>

                    <label className="block">
                      <span className="block text-sm/none text-nav-muted mb-3">Payout wallet</span>
                      <input
                        value={wallet}
                        onChange={(e) => setWallet(e.target.value)}
                        placeholder="0x…"
                        spellCheck={false}
                        disabled={submitting}
                        className={`${INPUT} font-mono text-sm/none placeholder:font-sans`}
                      />
                      <span className="block mt-3 px-5 text-sm/none text-nav-muted">
                        G$ payments land here. Defaults to your connected wallet.
                      </span>
                    </label>

                    {/* Location — same drag-to-confirm map picker used for G$ drops, so
                        a rough GPS fix can be corrected by hand instead of silently
                        placing the shop in the wrong spot. */}
                    <div>
                      <span className="block text-sm/none text-nav-muted mb-3">Shop location</span>
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        disabled={submitting}
                        className={`w-full h-14 rounded-full px-5 flex items-center gap-3 text-base/none cursor-pointer
                          motion-safe:transition-colors disabled:opacity-60
                          ${coords ? "bg-brand-soft text-brand" : "border border-line bg-white text-heading hover:bg-surface"}`}
                      >
                        {coords ? <Check className="w-5 h-5 shrink-0" strokeWidth={2} /> : <MapPin className="w-5 h-5 shrink-0" strokeWidth={1.75} />}
                        <span className="truncate">
                          {coords
                            ? (placeName || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`)
                            : "Pin your shop on the map"}
                        </span>
                        {coords && <span className="ml-auto shrink-0 text-sm/none text-brand/70">Adjust</span>}
                      </button>
                      <span className="block mt-3 px-5 text-sm/[140%] text-nav-muted">
                        Drag the pin to your exact shopfront — customers must be within 150m to pay.
                      </span>
                    </div>

                    <p
                      role="status"
                      aria-live="polite"
                      className={`min-h-4 px-5 text-sm/[140%] ${errMsg ? "text-danger" : "text-nav-muted"}`}
                    >
                      {errMsg}
                    </p>

                    <div className="flex flex-col-reverse sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={() => { setShowForm(false); setErrMsg(""); }}
                        disabled={submitting}
                        className="h-14 sm:flex-1 rounded-full border border-line bg-white text-base/none text-heading cursor-pointer
                          motion-safe:transition-colors hover:bg-surface disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        className="h-14 sm:flex-1 rounded-full bg-brand text-white text-base/none cursor-pointer
                          flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
                          disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
                      >
                        {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
                        {submitting ? "Registering…" : "Submit for review"}
                      </button>
                    </div>
                  </form>
                )}

                {/* ── Your spots ──────────────────────────────────────────── */}
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-xl/none text-heading">Your spots</h2>
                  {!loading && (
                    <span className="rounded-full bg-white px-3 py-2 text-sm/none text-nav-muted">{mySpots.length}</span>
                  )}
                </div>

                {loading ? (
                  <div className="flex flex-col gap-y-6">
                    {[1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-3xl bg-white" />)}
                  </div>
                ) : mySpots.length === 0 ? (
                  <div className={`${CARD} p-6 flex flex-col items-center text-center gap-y-4`}>
                    <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-heading">
                      <Store className="w-6 h-6" strokeWidth={1.75} />
                    </span>
                    <p className="text-xl/none text-heading">No spots yet</p>
                    <p className="text-sm/[140%] text-nav-muted max-w-[320px]">
                      Register your shop and start accepting G$ from hunters nearby.
                    </p>
                    {!showForm && registerButton("mt-2 h-12 px-6 text-base/none")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-y-6">
                    {mySpots.map((s) => <MerchantSpotCard key={s.id} spot={s} onChanged={fetchMySpots} />)}
                  </div>
                )}
              </div>

              {/* ── Side column ───────────────────────────────────────────── */}
              <aside className="flex flex-col gap-y-6 min-w-0">
                {/* Scan & approve task rewards — only useful once a spot is live */}
                {hasLiveSpot && (
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className={`${CARD} group p-2 pr-5 flex items-center gap-4 text-left cursor-pointer
                      motion-safe:transition-colors hover:bg-surface`}
                  >
                    <span className="w-14 h-14 shrink-0 rounded-full bg-brand text-white flex items-center justify-center">
                      <Camera className="w-6 h-6" strokeWidth={1.75} />
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-y-2">
                      <span className="text-base/none text-heading">Scan &amp; approve a reward</span>
                      <span className="text-sm/none text-nav-muted truncate">A hunter did your task? Scan their code.</span>
                    </span>
                    <ArrowRight className="w-5 h-5 shrink-0 text-nav-muted motion-safe:transition-transform group-hover:motion-safe:translate-x-1" strokeWidth={1.75} />
                  </button>
                )}

                <HowRewardsWork />

                {/* Secondary path for brands/events — batch drop campaigns live here now,
                    not in the main nav. Kept one tap away for whoever actually needs it. */}
                <Link
                  href="/sponsor"
                  className={`${CARD} group p-2 pr-5 flex items-center gap-4 cursor-pointer motion-safe:transition-colors hover:bg-surface`}
                >
                  <span className="w-14 h-14 shrink-0 rounded-full bg-surface group-hover:bg-white flex items-center justify-center text-heading">
                    <Megaphone className="w-6 h-6" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-y-2">
                    <span className="text-base/none text-heading">Running an event or campaign?</span>
                    <span className="text-sm/[140%] text-nav-muted">Drop lots of G$ across an area at once and track claims.</span>
                  </span>
                  <ArrowRight className="w-5 h-5 shrink-0 text-nav-muted motion-safe:transition-transform group-hover:motion-safe:translate-x-1" strokeWidth={1.75} />
                </Link>
              </aside>
            </div>
          )}
        </div>
      </div>

      {showScanner && <TaskScanner onClose={() => setShowScanner(false)} />}

      {/* Drag-to-confirm map picker — identical to the G$ drop flow */}
      <LocationPickerSheet
        open={pickerOpen}
        initialCenter={coords ?? myLoc}
        currentLocation={myLoc}
        followLocation={!coords}
        landmarks={landmarks}
        pinIcon={<Store size={20} />}
        confirmLabel="Pin my shop here"
        onConfirm={(lat, lng, place) => {
          setCoords({ lat, lng });
          setPlaceName(place);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
