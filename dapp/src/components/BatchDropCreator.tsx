"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import dynamic from "next/dynamic";
import { useWriteContract, useReadContract } from "wagmi";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { parseUnits, maxUint256 } from "viem";
import { X, Trash2, Loader2, Navigation, ChevronUp, ChevronDown } from "lucide-react";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI,
  G_TOKEN_ADDRESS, ERC20_ABI,
} from "@/lib/contracts";
import { degToGps, buildCampaignHint, formatG$, X_HANDLES, X_HASHTAGS } from "@/lib/utils";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import type { Campaign } from "@/types";

interface FlyTarget { lat: number; lng: number; seq: number; }

const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

const DURATIONS = [
  { label: "1h",  seconds: 3_600 },
  { label: "6h",  seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
  { label: "7d",  seconds: 604_800 },
];

interface QueuedDrop { id: string; lat: number; lng: number; amount: string; hint: string; }
type Status = "idle" | "approving" | "deploying" | "done" | "error";

// Queued-drop pin (numbered, click to remove).
function queuedPinEl(index: number, amount: string, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = `<div style="
    width:46px;height:46px;
    background:${color};
    border:2.5px solid #111;
    border-radius:50%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-weight:900;font-size:10px;color:#111;
    cursor:pointer;font-family:'Space Grotesk',sans-serif;
    user-select:none;box-shadow:2px 2px 0 #111;gap:1px;
  "><span style="font-size:12px;line-height:1">${index + 1}</span><span>${amount}G$</span></div>`;
  return el;
}

// Ghost pin that follows the cursor to preview where the drop will land.
function previewPinEl(amount: string, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.innerHTML = `<div style="
    width:46px;height:46px;
    background:${color};
    border:2.5px dashed #111;
    border-radius:50%;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-weight:900;font-size:10px;color:#111;
    opacity:0.65;
    font-family:'Space Grotesk',sans-serif;
    pointer-events:none;user-select:none;gap:1px;
  "><span style="font-size:14px;line-height:1">+</span><span>${amount || "?"}G$</span></div>`;
  return el;
}

const DynamicMap = dynamic(
  () => Promise.resolve(function BatchMap({ drops, onAdd, onRemove, campaign, flyTarget, defaultAmount }: {
    drops: QueuedDrop[]; onAdd: (lat: number, lng: number) => void;
    onRemove: (id: string) => void; campaign: Campaign; flyTarget: FlyTarget | null;
    defaultAmount: string;
  }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef       = useRef<maplibregl.Map | null>(null);
    const pinsRef      = useRef<maplibregl.Marker[]>([]);
    const previewRef   = useRef<maplibregl.Marker | null>(null);
    const lastSeqRef   = useRef(-1);
    const [ready, setReady] = useState(false);

    // Latest props/callbacks in refs so the init effect runs exactly once.
    const onAddRef    = useRef(onAdd);        onAddRef.current = onAdd;
    const colorRef    = useRef(campaign.color); colorRef.current = campaign.color;
    const amountRef   = useRef(defaultAmount);  amountRef.current = defaultAmount;

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
            element: previewPinEl(amountRef.current, colorRef.current),
            anchor: "center",
          }).setLngLat(e.lngLat).addTo(map);
        } else {
          previewRef.current.setLngLat(e.lngLat);
        }
      });
      map.on("mouseout", () => { previewRef.current?.remove(); previewRef.current = null; });

      map.on("load", () => setReady(true));
      return () => { map.remove(); mapRef.current = null; setReady(false); };
    }, []);

    // ── Queued pins ────────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !ready) return;
      pinsRef.current.forEach((m) => m.remove());
      pinsRef.current = drops.map((drop, i) => {
        const el = queuedPinEl(i, drop.amount, campaign.color);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); onRemove(drop.id); });
        return new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([drop.lng, drop.lat])
          .addTo(map);
      });
    }, [drops, campaign.color, onRemove, ready]);

    // ── Fly to target ──────────────────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !flyTarget || flyTarget.seq === lastSeqRef.current) return;
      lastSeqRef.current = flyTarget.seq;
      map.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 16, duration: 800 });
    }, [flyTarget]);

    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {/* Zoom controls */}
        <div style={{
          position: "absolute", top: 12, right: 12, zIndex: 1000,
          display: "flex", flexDirection: "column",
          border: "2px solid #111", borderRadius: 10, overflow: "hidden",
          boxShadow: "2px 2px 0 #111",
        }}>
          {[{ label: "+", delta: 1 }, { label: "−", delta: -1 }].map(({ label, delta }) => (
            <button
              key={delta}
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                if (delta === 1) map.zoomIn({ duration: 250 });
                else map.zoomOut({ duration: 250 });
              }}
              style={{
                width: 36, height: 36, background: "#fff", border: "none",
                borderBottom: delta === 1 ? "1.5px solid #111" : "none",
                cursor: "pointer", fontFamily: "inherit",
                fontWeight: 900, fontSize: 18, color: "#111",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#BFFD00"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }),
  { ssr: false, loading: () => <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#e8e6e0", fontSize: 32 }}>🗺️</div> }
);

interface Props {
  open: boolean; campaign: Campaign;
  onClose: () => void; onSuccess: () => void;
}

export function BatchDropCreator({ open, campaign, onClose, onSuccess }: Props) {
  const { address, isConnected } = useSignedInAccount();
  const { writeContractAsync }   = useWriteContract();
  const { balance, isFetching }  = useGoodDollarProfile();

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

  const totalWei = drops.reduce((s, d) => {
    const n = parseFloat(d.amount);
    return isNaN(n) || n <= 0 ? s : s + parseUnits(d.amount, 18);
  }, 0n);

  const insufficientBalance = isConnected && !isFetching && totalWei > 0n && totalWei > balance;
  const amtInRange = (amt: string): boolean => {
    const n = parseFloat(amt);
    if (isNaN(n) || n <= 0) return false;
    try { const w = parseUnits(amt, 18); return w >= minDrop && w <= maxDrop; } catch { return false; }
  };
  const outOfRange = drops.some((d) => {
    const n = parseFloat(d.amount);
    return !isNaN(n) && n > 0 && !amtInRange(d.amount);
  });
  const canDeploy = isConnected && drops.length > 0 && !insufficientBalance &&
    drops.every((d) => amtInRange(d.amount)) && status === "idle";

  async function handleDeploy() {
    if (!address || !canDeploy) return;
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
      // See CreateDropSheet for the full rationale (a naive "+120" overflowed 30d).
      const SKEW = 300;
      const nowSec = Math.floor(Date.now() / 1000);
      const maxDuration = Math.max(...DURATIONS.map((d) => d.seconds));
      const expiry = Math.min(nowSec + duration + SKEW, nowSec + maxDuration - SKEW);
      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];
        setProgress({ current: i + 1, total: drops.length });
        const tx = await writeContractAsync({
          address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
          args: [degToGps(drop.lat), degToGps(drop.lng), parseUnits(drop.amount, 18) as bigint, expiry, buildCampaignHint(drop.hint || defaultHint, campaign.id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }
      setStatus("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong");
      setStatus("error");
    }
  }

  function handleReset() { setDrops([]); setStatus("idle"); setErrMsg(""); setProgress({ current: 0, total: 0 }); }

  const busy = status === "approving" || status === "deploying";

  if (!open) return null;

  const btnActive = canDeploy || status === "error";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1020, background: "#f5f4f0", display: "flex", flexDirection: "column" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        borderBottom: "2px solid #111",
        borderTop: `4px solid ${campaign.color}`,
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 12,
        background: "#111", flexShrink: 0,
      }}>
        <button
          onClick={status === "done" ? () => { handleReset(); onSuccess(); } : onClose}
          disabled={busy}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "rgba(255,255,255,0.08)", border: "1.5px solid #333",
            cursor: busy ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#888", fontFamily: "inherit",
          }}
        >
          <X size={15} color="#888" />
        </button>

        {/* Campaign badge */}
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: campaign.color, border: "2px solid rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 900, fontSize: 13, color: "#111", flexShrink: 0,
          overflow: "hidden",
        }}>
          {campaign.logo
            ? <img src={campaign.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : campaign.name.charAt(0).toUpperCase()
          }
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 14, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {campaign.name}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "#555" }}>Tap map to place · tap pin to remove</p>
        </div>

        {/* Drop count badge */}
        {drops.length > 0 && (
          <div style={{
            background: campaign.color, color: "#111",
            border: "2px solid rgba(255,255,255,0.15)",
            borderRadius: 100, padding: "3px 10px",
            fontWeight: 900, fontSize: 12, flexShrink: 0,
          }}>
            {drops.length} drop{drops.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <DynamicMap drops={drops} onAdd={handleAdd} onRemove={handleRemove} campaign={campaign} flyTarget={flyTarget} defaultAmount={defaultAmount} />

        {/* Empty state hint */}
        {drops.length === 0 && (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "rgba(17,17,17,0.82)", color: "#fff",
            borderRadius: 14, padding: "14px 22px",
            fontSize: 13, fontWeight: 700,
            pointerEvents: "none", zIndex: 100,
            textAlign: "center", lineHeight: 1.6,
            backdropFilter: "blur(4px)",
          }}>
            👆 Tap anywhere on the map<br />to place a drop
          </div>
        )}

        {/* ── My Location button ──────────────────────────────────────────── */}
        <button
          onClick={handleLocate}
          disabled={locating}
          style={{
            position: "absolute", bottom: 16, right: 16, zIndex: 1000,
            height: 44,
            background: locating ? "#f0f0f0" : "#fff",
            border: "2px solid #111",
            borderRadius: 12,
            boxShadow: "2px 2px 0 #111",
            cursor: locating ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "0 14px",
            fontWeight: 800, fontSize: 13, color: "#111",
            fontFamily: "inherit", whiteSpace: "nowrap",
            transition: "background 0.1s, box-shadow 0.1s, transform 0.1s",
          }}
          onMouseEnter={(e) => { if (!locating) { e.currentTarget.style.background = "#BFFD00"; e.currentTarget.style.boxShadow = "0 0 0 #111"; e.currentTarget.style.transform = "translate(2px,2px)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = locating ? "#f0f0f0" : "#fff"; e.currentTarget.style.boxShadow = "2px 2px 0 #111"; e.currentTarget.style.transform = "translate(0,0)"; }}
        >
          {locating
            ? <Loader2 size={16} color="#888" style={{ animation: "spin 1s linear infinite" }} />
            : <Navigation size={16} color="#111" strokeWidth={2.5} />
          }
          {locating ? "Locating…" : "My Location"}
        </button>

        {/* Location error */}
        {locErr && (
          <div style={{
            position: "absolute", bottom: 70, right: 16, zIndex: 1000,
            background: "#111", color: "#fff",
            fontSize: 12, fontWeight: 600,
            padding: "6px 12px", borderRadius: 8,
            whiteSpace: "nowrap", fontFamily: "inherit", pointerEvents: "none",
          }}>
            {locErr}
          </div>
        )}
      </div>

      {/* ── Bottom panel ────────────────────────────────────────────────────── */}
      <div style={{
        background: "#f5f4f0",
        borderTop: "2px solid #111",
        flexShrink: 0,
        maxHeight: panelOpen ? "54vh" : "56px",
        overflow: "hidden",
        transition: "max-height 0.3s ease",
      }}>

        {/* Panel toggle header */}
        <button
          onClick={() => setPanelOpen((p) => !p)}
          style={{
            width: "100%", padding: "13px 16px",
            background: "transparent", border: "none",
            borderBottom: panelOpen ? "1.5px solid #e8e6e0" : "none",
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 900, fontSize: 14, color: "#111" }}>
              {drops.length === 0 ? "No drops placed yet" : `${drops.length} drop${drops.length !== 1 ? "s" : ""} queued`}
            </span>
            {totalWei > 0n && (
              <span style={{
                background: campaign.color, color: "#111",
                fontSize: 11, fontWeight: 900,
                padding: "2px 8px", borderRadius: 100,
                border: "1.5px solid #111",
              }}>
                {formatG$(totalWei)} G$
              </span>
            )}
            {insufficientBalance && (
              <span style={{ fontSize: 11, color: "#FF3B3B", fontWeight: 700 }}>Insufficient balance</span>
            )}
            {outOfRange && (
              <span style={{ fontSize: 11, color: "#FF3B3B", fontWeight: 700 }}>
                Each drop must be {formatG$(minDrop)}–{formatG$(maxDrop)} G$
              </span>
            )}
          </div>
          {panelOpen ? <ChevronDown size={16} color="#888" /> : <ChevronUp size={16} color="#888" />}
        </button>

        {panelOpen && (
          <div style={{ overflowY: "auto", maxHeight: "calc(54vh - 58px)", padding: "14px 16px 0" }}>

            {/* ── Success state ──────────────────────────────────────────── */}
            {status === "done" && (
              <div style={{
                background: "#111", border: "2px solid #111",
                borderRadius: 18, boxShadow: `4px 4px 0 ${campaign.color}`,
                overflow: "hidden", marginBottom: 16,
              }}>
                {/* Hero */}
                <div style={{ padding: "24px 20px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 14 }}>🎯</div>
                  <p style={{ margin: "0 0 6px", fontWeight: 900, fontSize: 22, color: campaign.color, letterSpacing: "-0.02em" }}>
                    {progress.total} drops live!
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: "#666", lineHeight: 1.5 }}>
                    Hidden for hunters on GoodDrops. Time to spread the word.
                  </p>
                </div>

                {/* Stats strip */}
                <div style={{
                  display: "flex", borderTop: "1.5px solid #1e1e1e", borderBottom: "1.5px solid #1e1e1e",
                }}>
                  {[
                    { label: "Drops placed", value: String(progress.total) },
                    { label: "G$ hidden",    value: formatG$(totalWei) + " G$" },
                    { label: "Campaign",     value: campaign.name },
                  ].map(({ label, value }, i) => (
                    <div key={label} style={{
                      flex: 1, padding: "10px 12px", textAlign: "center",
                      borderRight: i < 2 ? "1.5px solid #1e1e1e" : "none",
                    }}>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 14, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</p>
                      <p style={{ margin: 0, fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{label}</p>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Twitter / X share — primary CTA */}
                  <button
                    onClick={() => {
                      const text = [
                        `🎯 Just hid ${formatG$(totalWei)} G$ across ${progress.total} real-world drops for the GoodDrops community!`,
                        ``,
                        `Verified humans — come hunt them down 👇`,
                        `gooddrops.xyz`,
                        ``,
                        X_HANDLES,
                        X_HASHTAGS,
                      ].join("\n");
                      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
                    }}
                    style={{
                      width: "100%", padding: "14px 16px",
                      background: "#fff", color: "#111",
                      border: "2px solid #fff", borderRadius: 12,
                      boxShadow: "3px 3px 0 rgba(255,255,255,0.2)",
                      fontWeight: 900, fontSize: 15,
                      cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                      letterSpacing: "-0.01em",
                      transition: "background 0.15s, color 0.15s, box-shadow 0.1s, transform 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#000";
                      e.currentTarget.style.color = "#fff";
                      e.currentTarget.style.boxShadow = "1px 1px 0 rgba(255,255,255,0.2)";
                      e.currentTarget.style.transform = "translate(2px,2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#fff";
                      e.currentTarget.style.color = "#111";
                      e.currentTarget.style.boxShadow = "3px 3px 0 rgba(255,255,255,0.2)";
                      e.currentTarget.style.transform = "translate(0,0)";
                    }}
                  >
                    {/* X logo */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    Post on X
                    <span style={{ fontSize: 12, opacity: 0.5 }}>↗</span>
                  </button>

                  {/* Done — secondary */}
                  <button
                    onClick={() => { handleReset(); onSuccess(); }}
                    style={{
                      width: "100%", padding: "12px",
                      background: "transparent", border: "1.5px solid #222",
                      borderRadius: 12, color: "#555",
                      fontWeight: 700, fontSize: 14,
                      cursor: "pointer", fontFamily: "inherit",
                      transition: "color 0.15s, border-color 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#444"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#555"; e.currentTarget.style.borderColor = "#222"; }}
                  >
                    Done — back to campaign
                  </button>
                </div>
              </div>
            )}

            {status !== "done" && (
              <>
                {/* ── Settings ────────────────────────────────────────────── */}
                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  {/* Amount */}
                  <div style={{ flex: "0 0 90px" }}>
                    <p style={{ margin: "0 0 5px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Amount (G$)
                    </p>
                    <div style={{ display: "flex", alignItems: "center", border: "2px solid #111", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                      <input
                        type="number" value={defaultAmount}
                        onChange={(e) => setDefaultAmount(e.target.value)}
                        min="1" max="500"
                        style={{ width: "100%", padding: "8px 10px", border: "none", fontSize: 15, fontWeight: 900, background: "transparent", outline: "none", fontFamily: "inherit" }}
                      />
                    </div>
                  </div>
                  {/* Clue */}
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <p style={{ margin: "0 0 5px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Default Clue
                    </p>
                    <input
                      type="text" value={defaultHint}
                      onChange={(e) => setDefaultHint(e.target.value.slice(0, 120))}
                      placeholder="Near the main entrance…"
                      style={{
                        width: "100%", padding: "8px 12px",
                        border: "2px solid #111", borderRadius: 10,
                        fontSize: 13, background: "#fff",
                        outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                {/* Expiry */}
                <div style={{ marginBottom: 14 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Expiry
                  </p>
                  <div style={{ display: "flex", gap: 6 }}>
                    {DURATIONS.map((d) => (
                      <button
                        key={d.seconds}
                        onClick={() => setDuration(d.seconds)}
                        style={{
                          padding: "6px 14px",
                          background: duration === d.seconds ? "#111" : "#fff",
                          color: duration === d.seconds ? campaign.color : "#111",
                          border: "2px solid #111", borderRadius: 8,
                          fontWeight: 800, fontSize: 12,
                          cursor: "pointer", fontFamily: "inherit",
                          boxShadow: duration === d.seconds ? "2px 2px 0 " + campaign.color : "none",
                        }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Queued drops */}
                {drops.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                    {drops.map((drop, i) => (
                      <div key={drop.id} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: "#fff", border: "1.5px solid #e8e6e0",
                        borderRadius: 10, padding: "8px 10px",
                      }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: "50%",
                          background: campaign.color, border: "2px solid #111",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 900, fontSize: 11, flexShrink: 0, color: "#111",
                        }}>
                          {i + 1}
                        </div>
                        <input
                          type="number" value={drop.amount}
                          onChange={(e) => updateDrop(drop.id, "amount", e.target.value)}
                          min="1" max="500"
                          style={{ width: 58, padding: "4px 6px", border: "1.5px solid #ddd", borderRadius: 6, fontSize: 13, fontWeight: 700, background: "#f9f9f7", outline: "none", fontFamily: "inherit" }}
                        />
                        <span style={{ fontSize: 11, color: "#888", fontWeight: 700, flexShrink: 0 }}>G$</span>
                        <input
                          type="text" value={drop.hint}
                          onChange={(e) => updateDrop(drop.id, "hint", e.target.value.slice(0, 120))}
                          placeholder="Clue (optional)"
                          style={{ flex: 1, padding: "4px 8px", border: "1.5px solid #ddd", borderRadius: 6, fontSize: 12, background: "#f9f9f7", outline: "none", fontFamily: "inherit" }}
                        />
                        <button onClick={() => handleRemove(drop.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0 }}>
                          <Trash2 size={14} color="#FF3B3B" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Error */}
                {(status === "error" || errMsg) && (
                  <div style={{
                    background: "#FFF0F0", border: "2px solid #FF3B3B",
                    borderRadius: 10, padding: "10px 14px",
                    fontSize: 13, color: "#FF3B3B", fontWeight: 600, marginBottom: 10,
                  }}>
                    {errMsg || "Something went wrong."}
                  </div>
                )}

                {/* Deploy button */}
                <div style={{ paddingBottom: 20 }}>
                  <button
                    onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handleDeploy}
                    disabled={busy || (status !== "error" && !canDeploy)}
                    style={{
                      width: "100%", padding: "16px",
                      background: btnActive ? campaign.color : "#e8e6e0",
                      color: btnActive ? "#111" : "#aaa",
                      border: "2px solid",
                      borderColor: btnActive ? "#111" : "#ddd",
                      borderRadius: 14,
                      boxShadow: btnActive ? "3px 3px 0 #111" : "none",
                      fontWeight: 900, fontSize: 15,
                      cursor: busy || (!canDeploy && status !== "error") ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      transition: "box-shadow 0.1s, transform 0.1s",
                    }}
                    onMouseEnter={(e) => { if (btnActive && !busy) { e.currentTarget.style.boxShadow = "1px 1px 0 #111"; e.currentTarget.style.transform = "translate(2px,2px)"; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = btnActive ? "3px 3px 0 #111" : "none"; e.currentTarget.style.transform = "translate(0,0)"; }}
                  >
                    {status === "approving" && <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Approving…</>}
                    {status === "deploying" && <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Deploying {progress.current}/{progress.total}…</>}
                    {status === "error"    && "Retry →"}
                    {status === "idle"    && (drops.length === 0 ? "Place drops on the map first" : `Deploy ${drops.length} drop${drops.length !== 1 ? "s" : ""} — ${formatG$(totalWei)} G$`)}
                  </button>
                  {isConnected && !isFetching && (
                    <p style={{ textAlign: "center", fontSize: 11, color: "#aaa", margin: "6px 0 0", fontWeight: 600 }}>
                      Balance: {formatG$(balance)} G$
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
