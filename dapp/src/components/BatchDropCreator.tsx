"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits, maxUint256 } from "viem";
import { X, Trash2, Loader2, ChevronDown, ChevronUp, Navigation } from "lucide-react";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI,
  G_TOKEN_ADDRESS, ERC20_ABI,
} from "@/lib/contracts";
import { degToGps, buildCampaignHint, formatG$ } from "@/lib/utils";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { decodeEventLog } from "viem";
import type { Campaign } from "@/types";
import clsx from "clsx";

let mountCount = 0;

interface FlyTarget { lat: number; lng: number; seq: number; }

function FlyController({ target }: { target: FlyTarget | null }) {
  const map    = useMap();
  const lastSeq = useRef(-1);
  useEffect(() => {
    if (!target || target.seq === lastSeq.current) return;
    lastSeq.current = target.seq;
    map.flyTo([target.lat, target.lng], 16, { animate: true, duration: 0.8 });
  }, [target, map]);
  return null;
}

const DURATIONS = [
  { label: "1h",  seconds: 3_600 },
  { label: "6h",  seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
  { label: "7d",  seconds: 604_800 },
];

interface QueuedDrop {
  id:     string;
  lat:    number;
  lng:    number;
  amount: string;
  hint:   string;
}

type Status = "idle" | "approving" | "deploying" | "done" | "error";

// ── Map layer: click to add, click existing to remove ─────────────────────────

function DropPlacerLayer({
  drops,
  onAdd,
  onRemove,
  campaign,
}: {
  drops: QueuedDrop[];
  onAdd: (lat: number, lng: number) => void;
  onRemove: (id: string) => void;
  campaign: Campaign;
}) {
  useMapEvents({
    click: (e) => {
      // Ignore clicks that landed on an existing marker
      if ((e.originalEvent.target as HTMLElement).closest(".leaflet-marker-icon")) return;
      onAdd(e.latlng.lat, e.latlng.lng);
    },
  });

  return (
    <>
      {drops.map((drop, i) => (
        <Marker
          key={drop.id}
          position={[drop.lat, drop.lng]}
          icon={L.divIcon({
            className: "",
            html: `<div style="
              width:44px;height:44px;
              background:${campaign.color};
              border:2.5px solid #111;
              border-radius:50%;
              display:flex;align-items:center;justify-content:center;
              font-weight:900;font-size:11px;color:#111;
              cursor:pointer;
              font-family:'Space Grotesk',sans-serif;
              user-select:none;
              box-shadow:2px 2px 0 #111;
            ">${drop.amount}G$</div>`,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          })}
          eventHandlers={{ click: () => onRemove(drop.id) }}
        />
      ))}
    </>
  );
}

const DynamicMap = dynamic(
  () =>
    Promise.resolve(function BatchMap({
      drops, onAdd, onRemove, campaign, flyTarget,
    }: {
      drops:     QueuedDrop[];
      onAdd:     (lat: number, lng: number) => void;
      onRemove:  (id: string) => void;
      campaign:  Campaign;
      flyTarget: FlyTarget | null;
    }) {
      const [mapKey] = useState(() => ++mountCount);
      return (
        <MapContainer
          key={mapKey}
          center={[6.5244, 3.3792]}
          zoom={13}
          style={{ width: "100%", height: "100%" }}
          zoomControl
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; OpenStreetMap &copy; CARTO'
            subdomains="abcd"
            maxZoom={20}
          />
          <FlyController target={flyTarget} />
          <DropPlacerLayer drops={drops} onAdd={onAdd} onRemove={onRemove} campaign={campaign} />
        </MapContainer>
      );
    }),
  { ssr: false, loading: () => <div className="w-full h-full bg-border flex items-center justify-center text-2xl">🗺️</div> }
);

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  open:      boolean;
  campaign:  Campaign;
  onClose:   () => void;
  onSuccess: () => void;
}

export function BatchDropCreator({ open, campaign, onClose, onSuccess }: Props) {
  const { address, isConnected }  = useAccount();
  const { writeContractAsync }    = useWriteContract();
  const { balance, isFetching }   = useGoodDollarProfile();

  const [drops, setDrops]         = useState<QueuedDrop[]>([]);
  const [defaultAmount, setDefaultAmount] = useState("10");
  const [defaultHint,   setDefaultHint]   = useState("");
  const [duration, setDuration]   = useState(86_400);
  const [panelOpen, setPanelOpen] = useState(true);

  const [status,   setStatus]     = useState<Status>("idle");
  const [progress, setProgress]   = useState({ current: 0, total: 0 });
  const [errMsg,   setErrMsg]     = useState("");

  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [locating,  setLocating]  = useState(false);
  const [locErr,    setLocErr]    = useState("");
  const flySeq = useRef(0);

  const idRef = useRef(0);

  // Auto-fly to user's location when the creator opens
  useEffect(() => {
    if (!open) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFlyTarget({ lat: pos.coords.latitude, lng: pos.coords.longitude, seq: ++flySeq.current });
      },
      () => {}, // silently ignore if denied
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 }
    );
  }, [open]);

  function handleLocate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    setLocErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setFlyTarget({ lat: pos.coords.latitude, lng: pos.coords.longitude, seq: ++flySeq.current });
      },
      () => {
        setLocating(false);
        setLocErr("Couldn't get location");
        setTimeout(() => setLocErr(""), 3000);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }

  const handleAdd = useCallback((lat: number, lng: number) => {
    const id = String(++idRef.current);
    setDrops((prev) => [...prev, { id, lat, lng, amount: defaultAmount, hint: defaultHint }]);
  }, [defaultAmount, defaultHint]);

  const handleRemove = useCallback((id: string) => {
    setDrops((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const updateDrop = (id: string, field: "amount" | "hint", value: string) => {
    setDrops((prev) => prev.map((d) => d.id === id ? { ...d, [field]: value } : d));
  };

  const totalWei = drops.reduce((s, d) => {
    const n = parseFloat(d.amount);
    return isNaN(n) || n <= 0 ? s : s + parseUnits(d.amount, 18);
  }, 0n);

  const insufficientBalance = isConnected && !isFetching && totalWei > 0n && totalWei > balance;

  const canDeploy =
    isConnected && drops.length > 0 && !insufficientBalance &&
    drops.every((d) => { const n = parseFloat(d.amount); return !isNaN(n) && n > 0; }) &&
    status === "idle";

  async function handleDeploy() {
    if (!address || !canDeploy) return;
    setStatus("approving");
    setErrMsg("");

    try {
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI,
        functionName: "allowance", args: [address, GOOD_DROPS_ADDRESS],
      });

      if (allowance < totalWei) {
        const approveTx = await writeContractAsync({
          address: G_TOKEN_ADDRESS, abi: ERC20_ABI,
          functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      setStatus("deploying");
      setProgress({ current: 0, total: drops.length });

      const expiry = Math.floor(Date.now() / 1000) + duration + 120;

      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];
        setProgress({ current: i + 1, total: drops.length });

        const storedHint = buildCampaignHint(drop.hint, campaign.id);
        const amountWei  = parseUnits(drop.amount, 18);

        const tx = await writeContractAsync({
          address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI,
          functionName: "createDrop",
          args: [degToGps(drop.lat), degToGps(drop.lng), amountWei as bigint, expiry, storedHint],
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

  function handleReset() {
    setDrops([]);
    setStatus("idle");
    setErrMsg("");
    setProgress({ current: 0, total: 0 });
  }

  const busy = status === "approving" || status === "deploying";

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1020,
        background: "#f5f4f0",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        borderBottom: "2px solid #111",
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 12,
        background: "#f5f4f0", flexShrink: 0, zIndex: 10,
      }}>
        <button
          onClick={status === "done" ? () => { handleReset(); onSuccess(); } : onClose}
          disabled={busy}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            border: "2px solid #111", background: "transparent",
            cursor: busy ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit",
          }}
        >
          <X size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: 15 }}>
            Place drops — {campaign.name}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "#888" }}>
            Tap the map to place · tap a pin to remove
          </p>
        </div>
        {/* Campaign color swatch */}
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: campaign.color, border: "2px solid #111",
          flexShrink: 0,
        }} />
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <DynamicMap drops={drops} onAdd={handleAdd} onRemove={handleRemove} campaign={campaign} flyTarget={flyTarget} />

        {/* Locate-me button */}
        <button
          onClick={handleLocate}
          title="Go to my location"
          style={{
            position: "absolute", bottom: 16, right: 16, zIndex: 1000,
            width: 44, height: 44,
            background: locating ? "#f0f0f0" : "#fff",
            border: "2px solid #111",
            borderRadius: 10,
            boxShadow: "2px 2px 0 #111",
            cursor: locating ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "box-shadow 0.1s, transform 0.1s",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#BFFD00"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = locating ? "#f0f0f0" : "#fff"; }}
        >
          {locating
            ? <Loader2 size={20} color="#888" style={{ animation: "spin 1s linear infinite" }} />
            : <Navigation size={20} color="#111" strokeWidth={2} />
          }
        </button>

        {/* Location error tooltip */}
        {locErr && (
          <div style={{
            position: "absolute", bottom: 68, right: 16, zIndex: 1000,
            background: "#111", color: "#fff",
            fontSize: 12, fontWeight: 600,
            padding: "6px 10px", borderRadius: 8,
            whiteSpace: "nowrap", fontFamily: "inherit",
            pointerEvents: "none",
          }}>
            {locErr}
          </div>
        )}

        {/* Map hint overlay */}
        {drops.length === 0 && (
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "rgba(17,17,17,0.8)", color: "#fff",
            borderRadius: 14, padding: "12px 20px",
            fontSize: 13, fontWeight: 700,
            pointerEvents: "none", zIndex: 100,
            textAlign: "center", lineHeight: 1.5,
          }}>
            👆 Tap anywhere on the map<br />to place a drop
          </div>
        )}
      </div>

      {/* ── Bottom panel ────────────────────────────────────────────────────── */}
      <div style={{
        background: "#f5f4f0",
        borderTop: "2px solid #111",
        flexShrink: 0,
        maxHeight: panelOpen ? "52vh" : "60px",
        overflow: "hidden",
        transition: "max-height 0.3s ease",
      }}>
        {/* Panel header */}
        <button
          onClick={() => setPanelOpen((p) => !p)}
          style={{
            width: "100%", padding: "12px 16px",
            background: "transparent", border: "none",
            borderBottom: panelOpen ? "1.5px solid #e8e6e0" : "none",
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 900, fontSize: 14 }}>
              {drops.length === 0 ? "No drops placed yet" : `${drops.length} drop${drops.length !== 1 ? "s" : ""} queued`}
            </span>
            {totalWei > 0n && (
              <span style={{
                background: campaign.color, color: "#111",
                fontSize: 11, fontWeight: 900,
                padding: "2px 8px", borderRadius: 100,
                border: "1.5px solid #111",
              }}>
                {formatG$(totalWei)} G$ total
              </span>
            )}
            {insufficientBalance && (
              <span style={{ fontSize: 11, color: "#FF3B3B", fontWeight: 700 }}>
                Insufficient balance
              </span>
            )}
          </div>
          {panelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>

        {panelOpen && (
          <div style={{ overflowY: "auto", maxHeight: "calc(52vh - 60px)", padding: "12px 16px 0" }}>

            {/* ── Done state ──────────────────────────────────────────────── */}
            {status === "done" && (
              <div style={{
                background: "#BFFD00", border: "2px solid #111",
                borderRadius: 14, padding: "16px",
                textAlign: "center", marginBottom: 12,
              }}>
                <div style={{ fontSize: 36 }}>🎉</div>
                <p style={{ margin: "8px 0 4px", fontWeight: 900, fontSize: 16 }}>
                  {progress.total} drops deployed!
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "#555" }}>
                  All campaign drops are now live on the map.
                </p>
                <button
                  onClick={() => { handleReset(); onSuccess(); }}
                  style={{
                    marginTop: 12, padding: "10px 24px",
                    background: "#111", color: "#BFFD00",
                    border: "2px solid #111", borderRadius: 10,
                    fontWeight: 900, fontSize: 13,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Done
                </button>
              </div>
            )}

            {status !== "done" && (
              <>
                {/* ── Default settings row ──────────────────────────────── */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 100 }}>
                    <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Default amount (G$)
                    </p>
                    <input
                      type="number"
                      value={defaultAmount}
                      onChange={(e) => setDefaultAmount(e.target.value)}
                      min="1" max="500"
                      style={{
                        width: "100%", padding: "7px 10px",
                        border: "2px solid #111", borderRadius: 8,
                        fontSize: 14, fontWeight: 700,
                        background: "#fff", outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                  <div style={{ flex: 2, minWidth: 140 }}>
                    <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Default clue
                    </p>
                    <input
                      type="text"
                      value={defaultHint}
                      onChange={(e) => setDefaultHint(e.target.value.slice(0, 120))}
                      placeholder="Near the main entrance…"
                      style={{
                        width: "100%", padding: "7px 10px",
                        border: "2px solid #111", borderRadius: 8,
                        fontSize: 13, background: "#fff",
                        outline: "none", fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>

                {/* Duration */}
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", width: "100%" }}>
                    Expiry (all drops)
                  </p>
                  {DURATIONS.map((d) => (
                    <button
                      key={d.seconds}
                      onClick={() => setDuration(d.seconds)}
                      style={{
                        padding: "5px 14px",
                        background: duration === d.seconds ? "#111" : "#fff",
                        color: duration === d.seconds ? "#BFFD00" : "#111",
                        border: "2px solid #111",
                        borderRadius: 8,
                        fontWeight: 700, fontSize: 12,
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>

                {/* ── Queued drop list ──────────────────────────────────── */}
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
                          background: campaign.color, border: "1.5px solid #111",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 900, fontSize: 10, flexShrink: 0,
                        }}>
                          {i + 1}
                        </div>
                        <input
                          type="number"
                          value={drop.amount}
                          onChange={(e) => updateDrop(drop.id, "amount", e.target.value)}
                          min="1" max="500"
                          style={{
                            width: 60, padding: "4px 6px",
                            border: "1.5px solid #ddd", borderRadius: 6,
                            fontSize: 13, fontWeight: 700,
                            background: "#f9f9f7", outline: "none",
                            fontFamily: "inherit",
                          }}
                        />
                        <span style={{ fontSize: 11, color: "#888", fontWeight: 600, flexShrink: 0 }}>G$</span>
                        <input
                          type="text"
                          value={drop.hint}
                          onChange={(e) => updateDrop(drop.id, "hint", e.target.value.slice(0, 120))}
                          placeholder="Clue (optional)"
                          style={{
                            flex: 1, padding: "4px 8px",
                            border: "1.5px solid #ddd", borderRadius: 6,
                            fontSize: 12, background: "#f9f9f7",
                            outline: "none", fontFamily: "inherit",
                          }}
                        />
                        <button
                          onClick={() => handleRemove(drop.id)}
                          style={{
                            background: "none", border: "none",
                            cursor: "pointer", padding: 4, flexShrink: 0,
                          }}
                        >
                          <Trash2 size={14} color="#FF3B3B" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Error ─────────────────────────────────────────────── */}
                {(status === "error" || errMsg) && (
                  <div style={{
                    background: "#FFF0F0", border: "2px solid #FF3B3B",
                    borderRadius: 10, padding: "10px 14px",
                    fontSize: 13, color: "#FF3B3B", fontWeight: 600,
                    marginBottom: 10,
                  }}>
                    {errMsg || "Something went wrong."}
                  </div>
                )}

                {/* ── Deploy button ──────────────────────────────────────── */}
                <div style={{ paddingBottom: 20 }}>
                  <button
                    onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handleDeploy}
                    disabled={busy || (status !== "error" && !canDeploy)}
                    style={{
                      width: "100%", padding: "14px",
                      background: canDeploy || status === "error" ? "#111" : "#e8e6e0",
                      color: canDeploy || status === "error" ? "#BFFD00" : "#aaa",
                      border: "2px solid",
                      borderColor: canDeploy || status === "error" ? "#111" : "#ddd",
                      borderRadius: 12,
                      fontWeight: 900, fontSize: 15,
                      cursor: busy || (!canDeploy && status !== "error") ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      boxShadow: canDeploy ? "3px 3px 0 #BFFD00" : "none",
                    }}
                  >
                    {status === "approving" && (
                      <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Approving G$ transfer…</>
                    )}
                    {status === "deploying" && (
                      <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Deploying {progress.current} of {progress.total}…</>
                    )}
                    {status === "error" && "Retry"}
                    {status === "idle" && (
                      drops.length === 0
                        ? "Place drops on the map first"
                        : `Deploy ${drops.length} drop${drops.length !== 1 ? "s" : ""} — ${formatG$(totalWei)} G$`
                    )}
                  </button>
                  {isConnected && !isFetching && (
                    <p style={{ textAlign: "center", fontSize: 11, color: "#888", margin: "6px 0 0" }}>
                      Balance: {formatG$(balance)} G$
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
