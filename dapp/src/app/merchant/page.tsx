"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Store, MapPin, Loader2, Check, TrendingUp } from "lucide-react";
import { Nav, BottomNav } from "@/components/Nav";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { formatG$, shortAddr } from "@/lib/utils";
import type { Spot, SpotPayment } from "@/types";
import clsx from "clsx";

const CATEGORIES = [
  { id: "food",      label: "🍲 Food & Drink" },
  { id: "retail",    label: "🛍️ Retail" },
  { id: "services",  label: "🔧 Services" },
  { id: "transport", label: "🛺 Transport" },
  { id: "other",     label: "🏪 Other" },
];

interface SpotStats { count: number; totalWei: string; payments: SpotPayment[] }

function SpotCard({ spot }: { spot: Spot }) {
  const [stats, setStats] = useState<SpotStats | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/spots/${spot.id}/payments`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [spot.id]);

  return (
    <div className="bg-card border-2 border-ink rounded-2xl p-4 shadow-brutal-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-lg leading-tight">{spot.name}</p>
          {spot.description && (
            <p className="text-xs text-muted mt-0.5">{spot.description}</p>
          )}
        </div>
        <span className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border-2 bg-lime border-ink text-ink whitespace-nowrap">
          🏪 Live
        </span>
      </div>

      <div className="text-xs text-muted space-y-1">
        <div>📍 {spot.lat.toFixed(4)}° N, {spot.lng.toFixed(4)}° E</div>
        <div>💳 Payouts → {shortAddr(spot.wallet)}</div>
        {spot.discount && <div>🎁 {spot.discount}</div>}
      </div>

      {/* Analytics — the merchant's proof of foot traffic */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-ink text-lime rounded-xl p-3">
          <div className="text-2xl font-black">{stats?.count ?? "…"}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Payments received</div>
        </div>
        <div className="bg-lime border-2 border-ink rounded-xl p-3">
          <div className="text-2xl font-black text-ink">
            {stats ? formatG$(BigInt(stats.totalWei)) : "…"} <span className="text-sm">G$</span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink/60">Total earned</div>
        </div>
      </div>

      {stats && stats.payments.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full py-2 rounded-xl text-xs font-bold border border-ink text-muted hover:bg-border transition-colors"
          >
            {expanded ? "Hide" : "Show"} recent payments {expanded ? "▲" : "▼"}
          </button>
          {expanded && (
            <div className="space-y-1.5">
              {stats.payments.slice(0, 10).map((p) => (
                <a
                  key={p.tx}
                  href={`https://celoscan.io/tx/${p.tx}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between text-xs bg-cream border border-border rounded-lg px-3 py-2 hover:border-ink transition-colors"
                  style={{ textDecoration: "none" }}
                >
                  <span className="font-bold text-ink">{formatG$(BigInt(p.amount))} G$</span>
                  <span className="text-muted">{shortAddr(p.payer)}</span>
                  <span className="text-muted">{new Date(p.ts * 1000).toLocaleDateString()}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MerchantPage() {
  const { address, isConnected } = useSignedInAccount();
  const { login } = useAuth();

  const [mySpots, setMySpots]   = useState<Spot[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName]           = useState("");
  const [description, setDesc]    = useState("");
  const [category, setCategory]   = useState("food");
  const [discount, setDiscount]   = useState("");
  const [wallet, setWallet]       = useState("");
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg]       = useState("");
  const [done, setDone]           = useState(false);

  const fetchMySpots = useCallback(() => {
    if (!address) { setMySpots([]); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/spots?owner=${address}`)
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

  function captureLocation() {
    if (!navigator.geolocation) { setErrMsg("Geolocation not supported"); return; }
    setLocating(true);
    setErrMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setErrMsg("Couldn't get location — enable GPS and try again");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

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
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not register spot");
      setDone(true);
      setShowForm(false);
      setName(""); setDesc(""); setDiscount(""); setCoords(null);
      fetchMySpots();
      setTimeout(() => setDone(false), 4000);
    } catch (e: unknown) {
      setErrMsg((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim().length >= 2 && coords !== null && !submitting;

  return (
    <div className="min-h-screen bg-cream pb-20">
      <Nav />

      <div className="max-w-3xl mx-auto px-4 pt-20 pb-8">
        <h1 className="text-3xl font-black tracking-tight mb-1">GoodSpots 🏪</h1>
        <p className="text-muted text-sm mb-6">
          Accept G$ at your shop. Hunters nearby see you on the map — payment only unlocks when they walk in.
        </p>

        {!isConnected ? (
          <div className="border-2 border-ink rounded-2xl p-8 text-center space-y-3 bg-card">
            <div className="text-5xl">🏪</div>
            <p className="font-bold text-lg">Sign in to register your shop</p>
            <p className="text-sm text-muted">Takes under a minute. No hardware needed — your phone is the terminal.</p>
            <button
              onClick={login}
              className="btn-brutal bg-ink text-lime px-8 py-3 rounded-xl font-black text-sm"
            >
              Sign In
            </button>
          </div>
        ) : (
          <>
            {done && (
              <div className="flex items-center gap-2 bg-lime border-2 border-ink rounded-xl px-4 py-3 mb-4 font-bold text-sm">
                <Check size={16} /> Your shop is live on the map!
              </div>
            )}

            {/* Value pitch + CTA */}
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="btn-brutal w-full bg-lime text-ink rounded-2xl p-5 mb-6 text-left"
              >
                <div className="flex items-center gap-3">
                  <Store size={28} strokeWidth={2.5} />
                  <div>
                    <p className="font-black text-lg leading-tight">Register your shop</p>
                    <p className="text-xs font-semibold opacity-70 mt-0.5">
                      Appear on the hunt map · verified foot traffic · near-zero fees
                    </p>
                  </div>
                </div>
              </button>
            )}

            {/* Registration form */}
            {showForm && (
              <div className="bg-card border-2 border-ink rounded-2xl p-5 shadow-brutal-sm mb-6 space-y-4">
                <p className="font-black text-lg">New GoodSpot</p>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">Shop name *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Mama Nkechi's Kitchen"
                    maxLength={60}
                    className="w-full border-2 border-ink rounded-xl px-4 py-3 font-semibold bg-cream outline-none focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">Description</label>
                  <input
                    value={description}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="Home-cooked meals, cold drinks"
                    maxLength={280}
                    className="w-full border-2 border-ink rounded-xl px-4 py-3 font-semibold bg-cream outline-none focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">Category</label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setCategory(c.id)}
                        className={clsx(
                          "px-3 py-2 rounded-xl text-xs font-bold border-2 transition-colors",
                          category === c.id ? "bg-ink text-lime border-ink" : "bg-cream text-muted border-border hover:border-ink",
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">G$ offer (optional)</label>
                  <input
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="10% off when you pay with G$"
                    maxLength={80}
                    className="w-full border-2 border-ink rounded-xl px-4 py-3 font-semibold bg-cream outline-none focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">Payout wallet</label>
                  <input
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    placeholder="0x…"
                    className="w-full border-2 border-ink rounded-xl px-4 py-3 font-mono text-sm bg-cream outline-none focus:bg-white"
                  />
                  <p className="text-[11px] text-muted mt-1">G$ payments land here. Defaults to your connected wallet.</p>
                </div>

                {/* Location capture — merchants register while standing in their shop */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">Shop location *</label>
                  <button
                    onClick={captureLocation}
                    disabled={locating}
                    className={clsx(
                      "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 transition-colors",
                      coords ? "bg-lime border-ink text-ink" : "bg-cream border-ink text-ink hover:bg-border",
                    )}
                  >
                    {locating ? <Loader2 size={16} className="animate-spin" />
                      : coords ? <Check size={16} />
                      : <MapPin size={16} />}
                    {locating ? "Getting GPS…"
                      : coords ? `Pinned: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                      : "Use my current location"}
                  </button>
                  <p className="text-[11px] text-muted mt-1">Stand inside your shop when you pin it — customers must be within 150m to pay.</p>
                </div>

                {errMsg && (
                  <div className="bg-danger/10 border-2 border-danger text-danger rounded-xl px-4 py-3 text-sm font-semibold">
                    {errMsg}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowForm(false); setErrMsg(""); }}
                    className="flex-1 py-3 rounded-xl font-bold text-sm border-2 border-ink bg-cream hover:bg-border transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={clsx(
                      "btn-brutal flex-1 py-3 rounded-xl font-black text-sm",
                      canSubmit ? "bg-ink text-lime" : "bg-border text-muted cursor-not-allowed shadow-none",
                    )}
                  >
                    {submitting ? "Registering…" : "Go live 🚀"}
                  </button>
                </div>
              </div>
            )}

            {/* My spots + analytics */}
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={16} />
              <p className="font-black text-base">Your spots ({mySpots.length})</p>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <div key={i} className="h-40 bg-border rounded-2xl animate-pulse" />)}
              </div>
            ) : mySpots.length === 0 ? (
              <div className="text-center py-10 space-y-2 text-muted">
                <div className="text-4xl">🗺️</div>
                <p className="font-bold text-ink">No spots yet</p>
                <p className="text-sm">Register your shop and start accepting G$ today.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {mySpots.map((s) => <SpotCard key={s.id} spot={s} />)}
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
