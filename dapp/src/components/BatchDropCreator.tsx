"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import dynamic from "next/dynamic";
import { useReadContract } from "wagmi";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { parseUnits, maxUint256 } from "viem";
import { X, Trash2, Loader2, ChevronUp, ChevronDown, MousePointerClick } from "lucide-react";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI,
  G_TOKEN_ADDRESS, ERC20_ABI,
} from "@/lib/contracts";
import { degToGps, buildCampaignHint, formatG$, X_HANDLES, X_HASHTAGS } from "@/lib/utils";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useProfile } from "@/hooks/useProfile";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { MapZoomControls } from "@/components/MapZoomControls";
import { MyLocationButton } from "@/components/MyLocationButton";
import { DropSuccessModal } from "@/components/drop/DropSuccessModal";
import { Card, Label, TextField } from "@/components/drop/controls";
import { MAP_STYLE } from "@/components/map/style";
import { dropTier, esc } from "@/components/map/markers";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { CampaignDisc } from "@/components/CampaignDisc";
import type { Campaign } from "@/types";

interface FlyTarget { lat: number; lng: number; seq: number; }

const DURATIONS = [
  { label: "1h",  seconds: 3_600 },
  { label: "6h",  seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
  { label: "7d",  seconds: 604_800 },
];

interface QueuedDrop { id: string; lat: number; lng: number; amount: string; hint: string; }
type Status = "idle" | "approving" | "deploying" | "done" | "error";

// Amounts come from free-text fields, so a half-typed ".5" or "1." reaches
// here. parseUnits throws on those, and this runs during render — degrade to 0n.
function toWei(amount: string): bigint {
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return 0n;
  const [whole = "", frac = ""] = amount.split(".");
  try { return parseUnits(`${whole || "0"}.${frac.slice(0, 18) || "0"}`, 18); } catch { return 0n; }
}

// ── Pins ──────────────────────────────────────────────────────────────────────
// HTML strings, not JSX: MapLibre markers take DOM elements (see map/markers.ts
// for why). Same glass pill + chest + tier chip as the live map, so a queued
// drop previews exactly how it will look once it's hidden.

const PILL =
  "flex items-center gap-x-2 rounded-full p-1 pr-1 bg-[#FFFFFF33] backdrop-blur-[20px] " +
  "shadow-[0_2px_8px_rgba(0,0,0,0.22)] select-none";

function valueChip(amount: string): string {
  const tier = dropTier(toWei(amount));
  const label = toWei(amount) > 0n ? `${esc(amount)} G$` : "? G$";
  return (
    `<span class="shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-xs/none" ` +
    `style="background:${tier.bg};border-color:${tier.border};color:${tier.text}">${label}</span>`
  );
}

// Queued-drop pin (numbered, click to remove).
function queuedPinEl(index: number, amount: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML =
    `<div class="${PILL} cursor-pointer" title="Tap to remove">` +
    `<span class="w-7 h-7 shrink-0 rounded-full bg-white text-heading text-xs/none flex items-center justify-center">${index + 1}</span>` +
    `<img src="/treasure-chest.png" alt="" width="32" height="32" class="w-8 h-8 shrink-0 pointer-events-none" />` +
    valueChip(amount) +
    `</div>`;
  return el;
}

// Ghost pin that follows the cursor to preview where the drop will land.
function previewPinEl(amount: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.innerHTML =
    `<div class="${PILL} opacity-70">` +
    `<span class="w-7 h-7 shrink-0 rounded-full bg-white text-heading text-base/none flex items-center justify-center">+</span>` +
    `<img src="/treasure-chest.png" alt="" width="32" height="32" class="w-8 h-8 shrink-0 pointer-events-none" />` +
    valueChip(amount) +
    `</div>`;
  return el;
}

const DynamicMap = dynamic(
  () => Promise.resolve(function BatchMap({ drops, onAdd, onRemove, flyTarget, defaultAmount, onMapReady }: {
    drops: QueuedDrop[]; onAdd: (lat: number, lng: number) => void;
    onRemove: (id: string) => void; flyTarget: FlyTarget | null;
    defaultAmount: string;
    onMapReady: (map: maplibregl.Map | null) => void;
  }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef       = useRef<maplibregl.Map | null>(null);
    const pinsRef      = useRef<maplibregl.Marker[]>([]);
    const previewRef   = useRef<maplibregl.Marker | null>(null);
    const lastSeqRef   = useRef(-1);
    const [ready, setReady] = useState(false);

    // Latest props/callbacks in refs so the init effect runs exactly once.
    const onAddRef    = useRef(onAdd);        onAddRef.current = onAdd;
    const amountRef   = useRef(defaultAmount);  amountRef.current = defaultAmount;
    const onReadyRef  = useRef(onMapReady);   onReadyRef.current = onMapReady;

    // ── Init (once) ────────────────────────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [3.3792, 6.5244],
        zoom: 13,
        attributionControl: false,
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;
      map.getCanvas().style.cursor = "crosshair";

      // Click the map (not a pin) to queue a drop. DOM pins stop their own
      // propagation, so this only fires for genuine map clicks.
      map.on("click", (e) => onAddRef.current(e.lngLat.lat, e.lngLat.lng));

      // Ghost preview pin follows the cursor.
      map.on("mousemove", (e) => {
        if (!previewRef.current) {
          previewRef.current = new maplibregl.Marker({
            element: previewPinEl(amountRef.current),
            anchor: "center",
          }).setLngLat(e.lngLat).addTo(map);
        } else {
          previewRef.current.setLngLat(e.lngLat);
        }
      });
      map.on("mouseout", () => { previewRef.current?.remove(); previewRef.current = null; });

      map.on("load", () => { setReady(true); onReadyRef.current(map); });
      return () => { map.remove(); mapRef.current = null; setReady(false); onReadyRef.current(null); };
    }, []);

    // The ghost pin shows the amount it'll be placed with — rebuild it when
    // that changes rather than letting it drift from the field.
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !previewRef.current) return;
      const at = previewRef.current.getLngLat();
      previewRef.current.remove();
      previewRef.current = new maplibregl.Marker({ element: previewPinEl(defaultAmount), anchor: "center" })
        .setLngLat(at).addTo(map);
    }, [defaultAmount]);

    // ── Queued pins ────────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !ready) return;
      pinsRef.current.forEach((m) => m.remove());
      pinsRef.current = drops.map((drop, i) => {
        const el = queuedPinEl(i, drop.amount);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); onRemove(drop.id); });
        return new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([drop.lng, drop.lat])
          .addTo(map);
      });
    }, [drops, onRemove, ready]);

    // ── Fly to target ──────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !flyTarget || flyTarget.seq === lastSeqRef.current) return;
      lastSeqRef.current = flyTarget.seq;
      map.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 16, duration: 800 });
    }, [flyTarget]);

    return <div ref={containerRef} className="absolute inset-0" />;
  }),
  { ssr: false, loading: () => <Skeleton className="absolute inset-0 rounded-none bg-[#242424]" /> }
);

interface Props {
  open: boolean; campaign: Campaign;
  onClose: () => void; onSuccess: () => void;
}

const CTA =
  "w-full cursor-pointer rounded-full bg-nav-active px-5 py-5 text-base/none text-white " +
  "flex items-center justify-center gap-2 motion-safe:transition-opacity hover:opacity-90 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const SECONDARY =
  "w-full h-12 cursor-pointer rounded-full border border-line bg-white text-sm/none text-heading " +
  "flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-surface";

const ROW_FIELD =
  "h-10 rounded-full bg-surface px-3 text-sm/none text-heading placeholder:text-nav-muted " +
  "border border-transparent outline-none focus:border-brand motion-safe:transition-colors disabled:opacity-60";

/**
 * Campaign batch creator: tap the map to queue drops, then deploy them all.
 *
 * Takes the whole screen because the map IS the form. On a phone the queue
 * panel is a sheet pinned to the bottom (collapsible, so the map gets the room
 * back); at lg it's a column beside the map. Once the batch is live the panel
 * hands over to the shared DropSuccessModal.
 */
export function BatchDropCreator({ open, campaign, onClose, onSuccess }: Props) {
  const { address, isConnected } = useSignedInAccount();
  const { writeContractAsync }   = useSponsoredWrite();
  const { balance, isFetching }  = useGoodDollarProfile();
  const profile = useProfile(address);
  const hasUsername = !!profile?.username;
  // Dropping is identity-gated (see drop/useCreateDrop) — batch drops too.
  const {
    isVerified, isLapsed, isLoading: identityLoading, checkFailed: identityCheckFailed,
  } = useIdentityStatus();

  // Per-drop limits from the contract (each drop must be in range, not just the total).
  const { data: maxDropWei } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "maxDropAmount" });
  const { data: minDropWei } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "minDropAmount" });
  const maxDrop = (maxDropWei as bigint | undefined) ?? parseUnits("500", 18);
  const minDrop = (minDropWei as bigint | undefined) ?? parseUnits("1", 18);

  const [drops,         setDrops]         = useState<QueuedDrop[]>([]);
  const [defaultAmount, setDefaultAmount] = useState("10");
  const [defaultHint,   setDefaultHint]   = useState("");
  const [duration,      setDuration]      = useState(86_400);
  const [panelOpen,     setPanelOpen]     = useState(true);
  const [status,        setStatus]        = useState<Status>("idle");
  const [progress,      setProgress]      = useState({ current: 0, total: 0 });
  const [errMsg,        setErrMsg]        = useState("");
  const [flyTarget,     setFlyTarget]     = useState<FlyTarget | null>(null);
  const [locating,      setLocating]      = useState(false);
  const [locErr,        setLocErr]        = useState("");
  const [map,           setMap]           = useState<maplibregl.Map | null>(null);
  const flySeq          = useRef(0);
  const idRef           = useRef(0);
  const cachedLocation  = useRef<{ lat: number; lng: number } | null>(null);

  // When the default clue changes, apply it to any drop that hasn't been individually edited
  useEffect(() => {
    setDrops(prev => prev.map(d => d.hint === "" ? { ...d, hint: defaultHint } : d));
  }, [defaultHint]);

  useEffect(() => {
    if (!open) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        cachedLocation.current = loc;
        setFlyTarget({ ...loc, seq: ++flySeq.current });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 }
    );
  }, [open]);

  // The page behind must not scroll while the creator owns the screen.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  function handleLocate() {
    // Use the already-known position instantly if available — same approach as LocationPickerSheet
    if (cachedLocation.current) {
      setFlyTarget({ ...cachedLocation.current, seq: ++flySeq.current });
      return;
    }
    // First open before auto-fly resolved: fall back to a fresh call
    if (!navigator.geolocation) return;
    setLocating(true);
    setLocErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        cachedLocation.current = loc;
        setFlyTarget({ ...loc, seq: ++flySeq.current });
      },
      () => { setLocating(false); setLocErr("Couldn't get location"); setTimeout(() => setLocErr(""), 3000); },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 }
    );
  }

  const handleAdd    = useCallback((lat: number, lng: number) => {
    setDrops((prev) => [...prev, { id: String(++idRef.current), lat, lng, amount: defaultAmount, hint: defaultHint }]);
  }, [defaultAmount, defaultHint]);

  const handleRemove = useCallback((id: string) => setDrops((prev) => prev.filter((d) => d.id !== id)), []);

  const updateDrop = (id: string, field: "amount" | "hint", value: string) =>
    setDrops((prev) => prev.map((d) => d.id === id ? { ...d, [field]: value } : d));

  const totalWei = drops.reduce((s, d) => s + toWei(d.amount), 0n);

  const insufficientBalance = isConnected && !isFetching && totalWei > 0n && totalWei > balance;
  const amtInRange = (amt: string): boolean => {
    const w = toWei(amt);
    return w > 0n && w >= minDrop && w <= maxDrop;
  };
  const outOfRange = drops.some((d) => toWei(d.amount) > 0n && !amtInRange(d.amount));
  const canDeploy = isConnected && hasUsername &&
    (isVerified || identityLoading || identityCheckFailed) &&
    drops.length > 0 && !insufficientBalance &&
    drops.every((d) => amtInRange(d.amount)) && status === "idle";

  async function handleDeploy() {
    if (!address) return;
    if (!hasUsername) {
      setErrMsg("Set a username before dropping.");
      window.dispatchEvent(new CustomEvent("gd:setName"));
      return;
    }
    if (!identityLoading && !identityCheckFailed && !isVerified) {
      setErrMsg(isLapsed ? "Re-verify your GoodDollar identity to drop." : "Verify your GoodDollar identity to drop.");
      window.dispatchEvent(new CustomEvent("gd:openVerify"));
      return;
    }
    if (!canDeploy) return;
    setStatus("approving");
    setErrMsg("");
    try {
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, GOOD_DROPS_ADDRESS],
      });
      if (allowance < totalWei) {
        const approveTx = await writeContractAsync({ address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256] });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }
      setStatus("deploying");
      setProgress({ current: 0, total: drops.length });
      // Keep expiry safely inside the contract window [now+minExpiryDuration,
      // now+maxExpiryDuration] despite mining latency / device-clock skew: pad the
      // lower bound (the "1h" option sits on the floor) and cap under the ceiling.
      // See drop/useCreateDrop for the full rationale (a naive "+120" overflowed 30d).
      const SKEW = 300;
      const nowSec = Math.floor(Date.now() / 1000);
      const maxDuration = Math.max(...DURATIONS.map((d) => d.seconds));
      const expiry = Math.min(nowSec + duration + SKEW, nowSec + maxDuration - SKEW);
      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];
        setProgress({ current: i + 1, total: drops.length });
        const tx = await writeContractAsync({
          address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
          args: [degToGps(drop.lat), degToGps(drop.lng), toWei(drop.amount), expiry, buildCampaignHint(drop.hint || defaultHint, campaign.id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }
      window.dispatchEvent(new CustomEvent("gd:drop-created"));
      setStatus("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong");
      setStatus("error");
    }
  }

  function handleReset() { setDrops([]); setStatus("idle"); setErrMsg(""); setProgress({ current: 0, total: 0 }); }

  const shareOnX = () => {
    const text = [
      `Just hid ${formatG$(totalWei)} G$ across ${progress.total} real-world drops for the GoodDrops community.`,
      ``,
      `Verified humans — come hunt them down.`,
      `gooddrops.xyz`,
      ``,
      X_HANDLES,
      X_HASHTAGS,
    ].join("\n");
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const busy = status === "approving" || status === "deploying";

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // The job has changed from "place drops" to "tell people" — the shared success
  // modal says that more clearly than a panel that suddenly reads differently.
  if (status === "done") {
    return (
      <DropSuccessModal
        amount={drops[0]?.amount ?? defaultAmount}
        amountWei={toWei(drops[0]?.amount ?? defaultAmount)}
        qty={progress.total}
        placeName={campaign.name}
        isPrivate={false}
        shareUrl={null}
        resuming={false}
        durationSeconds={duration}
        onShare={shareOnX}
        onClose={() => { handleReset(); onSuccess(); }}
      />
    );
  }

  const identityBlocked = isConnected && hasUsername && !identityLoading && !isVerified;
  const queuedLabel = drops.length === 0
    ? "No drops placed yet"
    : `${drops.length} drop${drops.length !== 1 ? "s" : ""} queued`;

  const ctaLabel =
    status === "approving" ? "Approving G$…" :
    status === "deploying" ? `Hiding ${progress.current} of ${progress.total}…` :
    status === "error"     ? "Try again" :
    drops.length === 0     ? "Place drops on the map first" :
    `Deploy ${drops.length} drop${drops.length !== 1 ? "s" : ""} — ${formatG$(totalWei)} G$`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add drops to ${campaign.name}`}
      className="modal-fade-in fixed inset-0 z-[1400] flex flex-col bg-nav font-sans lg:flex-row"
    >
      {/* ── Map ──────────────────────────────────────────────────────────── */}
      {/* Dark under the tiles: the basemap is dark, so the glass pills read the
          same before the first tile lands as after. */}
      <div className="relative min-h-0 flex-1 bg-[#1B1B1B]">
        <DynamicMap
          drops={drops}
          onAdd={handleAdd}
          onRemove={handleRemove}
          flyTarget={flyTarget}
          defaultAmount={defaultAmount}
          onMapReady={setMap}
        />

        {/* Campaign + close, top corners — same placement as the picker's search. */}
        <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between gap-3 lg:left-[60px] lg:top-5">
          <div className="flex min-w-0 items-center gap-x-3 rounded-full bg-white p-1.5 pr-4 shadow-[0px_0px_12px_0px_#0000000A]">
            <CampaignDisc campaign={campaign} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm/none text-heading">{campaign.name}</p>
              <p className="mt-1.5 truncate text-xs/none text-nav-muted">Tap the map to place, tap a pin to remove</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white
              text-heading shadow-[0px_0px_12px_0px_#0000000A] motion-safe:transition-colors hover:bg-surface
              disabled:cursor-not-allowed disabled:opacity-50 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Empty-state nudge, centred on the map. */}
        {drops.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[#FFFFFF33] px-4 py-3 text-sm/none text-white backdrop-blur-[20px]">
            <MousePointerClick className="h-4 w-4" />
            Tap anywhere on the map to place a drop
          </div>
        )}

        {/* Map controls — the same components the map page uses. */}
        <div className="absolute bottom-5 left-5 z-20 flex flex-col items-start gap-3 lg:bottom-[60px] lg:left-[60px]">
          <MapZoomControls map={map} />
          <MyLocationButton onClick={handleLocate} locating={locating} error={locErr || undefined} />
        </div>
      </div>

      {/* ── Queue panel ──────────────────────────────────────────────────── */}
      <div
        className={`flex shrink-0 flex-col rounded-t-3xl bg-white shadow-[0px_0px_12px_0px_#0000000A]
          lg:w-[440px] lg:max-h-none lg:rounded-none lg:border-l lg:border-line
          ${panelOpen ? "max-h-[55dvh]" : "max-h-none"}`}
      >
        {/* Header. On a phone it also collapses the panel so the map gets the
            room back; at lg the panel is always open, so the chevron hides. */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-5 lg:border-b lg:border-line lg:pt-6">
          <button
            type="button"
            onClick={() => setPanelOpen((p) => !p)}
            aria-expanded={panelOpen}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left lg:cursor-default"
          >
            <span className="truncate text-base/none text-heading">{queuedLabel}</span>
            {totalWei > 0n && (
              <span className="shrink-0 rounded-full bg-brand-soft px-3 py-1.5 text-xs/none text-brand">
                {formatG$(totalWei)} G$
              </span>
            )}
            <span className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-nav-muted lg:hidden">
              {panelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </span>
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="hidden h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface text-black
              motion-safe:transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 lg:flex"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto px-6 pb-[calc(24px+env(safe-area-inset-bottom,0px))] ${panelOpen ? "" : "hidden lg:block"}`}>
          <div className="space-y-5">
            {/* ── Defaults for the next pin ── */}
            <div className="grid grid-cols-[128px_1fr] gap-3">
              <div>
                <Label>Amount</Label>
                <TextField
                  inputMode="decimal"
                  value={defaultAmount}
                  disabled={busy}
                  placeholder="0.00"
                  suffix="G$"
                  aria-label="Amount for each new drop"
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
                    setDefaultAmount(v);
                  }}
                />
              </div>
              <div>
                <Label hint={`${defaultHint.length}/120`}>Default clue</Label>
                <TextField
                  value={defaultHint}
                  disabled={busy}
                  maxLength={120}
                  placeholder="Near the main entrance"
                  aria-label="Default clue"
                  onChange={(e) => setDefaultHint(e.target.value.slice(0, 120))}
                />
              </div>
            </div>

            {/* ── Expiry ── */}
            <div>
              <Label>Drops expire in</Label>
              <div className="flex items-center gap-2">
                {DURATIONS.map(({ label, seconds }) => {
                  const active = duration === seconds;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setDuration(seconds)}
                      disabled={busy}
                      aria-pressed={active}
                      className={`flex-1 cursor-pointer rounded-full border py-3.5 text-sm/none motion-safe:transition-colors
                        ${active ? "border-brand bg-brand text-white" : "border-line text-heading hover:bg-surface"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Queue ── */}
            {drops.length > 0 && (
              <Card className="p-3 space-y-2">
                {drops.map((drop, i) => (
                  <div key={drop.id} className="flex items-center gap-2 rounded-full border border-line p-1.5 pr-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-sm/none text-heading">
                      {i + 1}
                    </span>
                    <input
                      inputMode="decimal"
                      value={drop.amount}
                      disabled={busy}
                      aria-label={`Drop ${i + 1} amount`}
                      onChange={(e) => updateDrop(drop.id, "amount", e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                      className={`${ROW_FIELD} w-[72px] shrink-0 text-center`}
                    />
                    <span className="shrink-0 text-xs/none text-nav-muted">G$</span>
                    <input
                      type="text"
                      value={drop.hint}
                      disabled={busy}
                      maxLength={120}
                      placeholder="Clue"
                      aria-label={`Drop ${i + 1} clue`}
                      onChange={(e) => updateDrop(drop.id, "hint", e.target.value.slice(0, 120))}
                      className={`${ROW_FIELD} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemove(drop.id)}
                      disabled={busy}
                      aria-label={`Remove drop ${i + 1}`}
                      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-nav-muted
                        motion-safe:transition-colors hover:bg-surface hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </Card>
            )}

            {/* ── Problems — one slot, so the layout never jumps ── */}
            <p role="status" aria-live="polite" className="min-h-4 text-center text-sm/[140%] text-danger">
              {status === "error" || errMsg
                ? (errMsg || "Something went wrong.")
                : outOfRange
                  ? `Each drop must be between ${formatG$(minDrop)} and ${formatG$(maxDrop)} G$.`
                  : insufficientBalance
                    ? `Not enough G$ — you have ${formatG$(balance)} G$.`
                    : ""}
            </p>

            {/* ── Gates + deploy ── */}
            <div className="space-y-3">
              {isConnected && !hasUsername && (
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("gd:setName"))}
                  className={SECONDARY}
                >
                  Set a username to drop
                </button>
              )}
              {identityBlocked && (
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("gd:openVerify"))}
                  className={SECONDARY}
                >
                  {identityCheckFailed
                    ? "Couldn't check verification — retry"
                    : isLapsed ? "Re-verify to drop" : "Verify to drop"}
                </button>
              )}
              <button
                type="button"
                onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handleDeploy}
                disabled={busy || (status !== "error" && !canDeploy)}
                className={CTA}
              >
                {busy && <Loader2 className="h-5 w-5 animate-spin" />}
                {ctaLabel}
              </button>
              {isConnected && !isFetching && (
                <p className="text-center text-xs/[150%] text-nav-muted">
                  Balance: {formatG$(balance)} G$ · each drop is its own transaction
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
