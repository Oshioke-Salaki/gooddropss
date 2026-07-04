"use client";
import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useWriteContract } from "wagmi";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { parseUnits, maxUint256 } from "viem";
import { decodeEventLog } from "viem";
import { Plus, Trash2, Loader2, Link2, Copy, Check, Trophy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI,
  G_TOKEN_ADDRESS, ERC20_ABI,
} from "@/lib/contracts";
import {
  degToGps, formatG$,
  buildChainHint, buildPrivateChainHint, buildChainLastHint,
} from "@/lib/utils";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import type { ChainStop } from "@/types";
import clsx from "clsx";

const DURATIONS = [
  { label: "1h",  seconds: 3_600 },
  { label: "6h",  seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
  { label: "7d",  seconds: 604_800 },
];

const MAX_STOPS = 5;

type Status = "idle" | "approving" | "deploying" | "done" | "error";

interface Props {
  open:        boolean;
  userLocation: { lat: number; lng: number } | null;
  onClose:     () => void;
  onSuccess:   () => void;
}

function makeEmptyStop(): ChainStop {
  return { lat: null, lng: null, place: null, amount: "10", clue: "" };
}

export function ChainDropCreator({ open, userLocation, onClose, onSuccess }: Props) {
  const { address, isConnected }  = useSignedInAccount();
  const { writeContractAsync }    = useWriteContract();
  const { balance, isFetching }   = useGoodDollarProfile();

  const [stops, setStops]         = useState<ChainStop[]>([makeEmptyStop(), makeEmptyStop()]);
  const [duration, setDuration]   = useState(86_400);
  const [status, setStatus]       = useState<Status>("idle");
  const [errMsg, setErrMsg]       = useState("");
  const [progress, setProgress]   = useState({ current: 0, total: 0 });
  const [firstDropId, setFirstDropId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied]   = useState(false);

  // Which stop is currently picking a location
  const [pickingIdx, setPickingIdx]   = useState<number | null>(null);

  const reset = useCallback(() => {
    setStops([makeEmptyStop(), makeEmptyStop()]);
    setDuration(86_400);
    setStatus("idle");
    setErrMsg("");
    setProgress({ current: 0, total: 0 });
    setFirstDropId(null);
    setLinkCopied(false);
    setPickingIdx(null);
  }, []);

  const handleClose = () => { reset(); onClose(); };

  function updateStop(idx: number, field: keyof ChainStop, value: string | number | null) {
    setStops((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }

  function addStop() {
    if (stops.length < MAX_STOPS) setStops((prev) => [...prev, makeEmptyStop()]);
  }

  function removeStop(idx: number) {
    if (stops.length <= 2) return;
    setStops((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleLocationConfirm(idx: number, lat: number, lng: number, place: string | null) {
    setStops((prev) => prev.map((s, i) =>
      i === idx ? { ...s, lat, lng, place } : s
    ));
    setPickingIdx(null);
  }

  const totalWei = stops.reduce((s, stop) => {
    const n = parseFloat(stop.amount);
    return isNaN(n) || n <= 0 ? s : s + parseUnits(stop.amount, 18);
  }, 0n);

  const insufficientBalance = isConnected && !isFetching && totalWei > 0n && totalWei > balance;

  const canDeploy =
    isConnected &&
    stops.length >= 2 &&
    stops.every((s) => s.lat !== null && s.lng !== null && !isNaN(parseFloat(s.amount)) && parseFloat(s.amount) > 0) &&
    !insufficientBalance &&
    status === "idle";

  async function handleDeploy() {
    if (!address || !canDeploy) return;
    setStatus("approving");
    setErrMsg("");

    try {
      // Single approval for total amount
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
      setProgress({ current: 0, total: stops.length });

      const expiry = Math.floor(Date.now() / 1000) + duration + 120;
      let nextDropId: string | null = null;

      // Deploy REVERSE: last stop first → get its ID → use it in the previous stop's hint
      for (let i = stops.length - 1; i >= 0; i--) {
        const stop     = stops[i];
        const isFirst  = i === 0;
        const isLast   = i === stops.length - 1;
        setProgress({ current: stops.length - i, total: stops.length });

        // Build hint based on position in chain
        let storedHint: string;
        if (isLast) {
          storedHint = buildChainLastHint(stop.clue);
        } else if (isFirst) {
          // First stop is PUBLIC — shows on the map as entry point
          storedHint = buildChainHint(stop.clue, nextDropId!);
        } else {
          // Middle stops are PRIVATE
          storedHint = buildPrivateChainHint(stop.clue, nextDropId!);
        }

        const amountWei = parseUnits(stop.amount, 18);
        const tx = await writeContractAsync({
          address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI,
          functionName: "createDrop",
          args: [
            degToGps(stop.lat!),
            degToGps(stop.lng!),
            amountWei as bigint,
            expiry,
            storedHint,
          ],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

        // Extract drop ID from DropCreated event
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: GOOD_DROPS_ABI, data: log.data, topics: log.topics, eventName: "DropCreated",
            });
            if (decoded.args.dropId !== undefined) {
              nextDropId = String(decoded.args.dropId);
              break;
            }
          } catch {}
        }
      }

      setFirstDropId(nextDropId); // last created = first stop (entry point)
      setStatus("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong");
      setStatus("error");
    }
  }

  const busy = status === "approving" || status === "deploying";
  const shareUrl = firstDropId
    ? `${typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz"}/drop/${firstDropId}`
    : null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        animate={{ opacity: open && pickingIdx === null ? 1 : 0, pointerEvents: open && pickingIdx === null ? "auto" : "none" }}
        transition={{ duration: 0.2 }}
        onClick={handleClose}
        style={{ position: "fixed", inset: 0, zIndex: 1004, backgroundColor: "rgba(17,17,17,0.55)", backdropFilter: "blur(2px)", opacity: 0, pointerEvents: "none" }}
      />

      {/* Sheet */}
      <motion.div
        animate={{ y: open && pickingIdx === null ? 0 : "100%" }}
        initial={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 420 }}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1005,
          borderRadius: "24px 24px 0 0",
          background: "#f5f4f0",
          borderTop: "2px solid #111",
          maxHeight: "92dvh",
          overflowY: "auto",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#888" }} />
        </div>

        <div className="px-5 pb-10 pt-2 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Link2 size={20} className="text-ink" />
                <h2 className="text-2xl font-black tracking-tight">Create Hunt Chain</h2>
              </div>
              <p className="text-sm text-muted mt-0.5">
                Link {stops.length} stops — first to find all wins 🏆
              </p>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full border-2 border-ink flex items-center justify-center font-bold text-sm hover:bg-ink hover:text-lime transition-colors"
            >✕</button>
          </div>

          {/* ── Done state ────────────────────────────────────────────────── */}
          {status === "done" && shareUrl && (
            <div className="space-y-4">
              <div className="bg-lime border-2 border-ink rounded-2xl p-5 text-center space-y-3">
                <div className="text-5xl">🔗</div>
                <p className="font-black text-xl">Hunt Chain deployed!</p>
                <p className="text-sm text-ink/70">
                  {stops.length} stops linked · {formatG$(totalWei)} G$ total reward
                </p>
              </div>

              <div className="bg-card border-2 border-ink rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">🔗 Entry link (stop 1)</p>
                <p className="text-xs text-muted">Share this link to start hunters on the chain. Each stop reveals the next.</p>
                <div className="flex justify-center">
                  <div className="border-2 border-ink rounded-xl p-3 bg-white inline-block">
                    <QRCodeSVG value={shareUrl} size={140} level="M" includeMargin={false} />
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-cream border border-ink rounded-lg px-3 py-2">
                  <span className="text-xs font-mono text-muted truncate flex-1 min-w-0">{shareUrl}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(shareUrl).then(() => {
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      });
                    }}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 bg-ink text-lime rounded-md"
                  >
                    {linkCopied ? <Check size={12} /> : <Copy size={12} />}
                    {linkCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <button onClick={() => { onSuccess(); reset(); }} className="w-full py-2.5 rounded-xl font-bold text-sm text-muted hover:text-ink transition-colors">
                Done
              </button>
            </div>
          )}

          {status !== "done" && (
            <>
              {/* ── Stop list ──────────────────────────────────────────────── */}
              <div className="space-y-3">
                {stops.map((stop, idx) => {
                  const isLast  = idx === stops.length - 1;
                  const isFinal = isLast;
                  return (
                    <div key={idx} className="bg-card border-2 border-ink rounded-2xl p-4 space-y-3">
                      {/* Stop header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={clsx(
                            "w-7 h-7 rounded-full border-2 border-ink flex items-center justify-center font-black text-xs",
                            isFinal ? "bg-lime" : "bg-ink text-lime"
                          )}>
                            {isFinal ? <Trophy size={13} /> : idx + 1}
                          </div>
                          <span className="font-black text-sm">
                            {isFinal ? "Final Reward 🏆" : `Stop ${idx + 1}`}
                          </span>
                          {idx === 0 && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-lime border border-ink text-ink">
                              Entry
                            </span>
                          )}
                        </div>
                        {stops.length > 2 && (
                          <button onClick={() => removeStop(idx)} className="p-1.5 rounded-lg hover:bg-danger/10 transition-colors">
                            <Trash2 size={14} color="#FF3B3B" />
                          </button>
                        )}
                      </div>

                      {/* Location picker */}
                      <button
                        onClick={() => setPickingIdx(idx)}
                        className="w-full text-left"
                      >
                        {stop.lat !== null ? (
                          <div className="flex items-center gap-3 bg-lime border-2 border-ink rounded-xl px-4 py-2.5 shadow-brutal-sm">
                            <span className="text-lg shrink-0">📍</span>
                            <div className="flex-1 min-w-0">
                              {stop.place && <p className="font-black text-sm truncate">{stop.place}</p>}
                              <p className="text-xs text-ink/60 font-mono">{stop.lat.toFixed(5)}°, {stop.lng?.toFixed(5)}°</p>
                            </div>
                            <span className="text-xs font-bold text-ink/50">Change →</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 border-2 border-dashed border-ink rounded-xl px-4 py-3 hover:bg-border transition-colors">
                            <div className="w-9 h-9 rounded-full bg-ink flex items-center justify-center shrink-0">
                              <span className="text-lime">📍</span>
                            </div>
                            <div>
                              <p className="font-black text-sm">Choose location</p>
                              <p className="text-xs text-muted">Search or pan the map</p>
                            </div>
                            <span className="ml-auto">→</span>
                          </div>
                        )}
                      </button>

                      {/* Amount + clue */}
                      <div className="flex gap-2">
                        <div className="w-28 shrink-0">
                          <label className="text-xs font-bold uppercase tracking-wider text-muted block mb-1">
                            {isFinal ? "Jackpot" : "Amount"}
                          </label>
                          <div className="flex items-center border-2 border-ink rounded-xl overflow-hidden">
                            <input
                              type="number"
                              value={stop.amount}
                              onChange={(e) => updateStop(idx, "amount", e.target.value)}
                              min="1" max="500"
                              className="flex-1 px-3 py-2 text-base font-black bg-transparent outline-none w-0"
                            />
                            <span className="pr-2 text-xs font-bold text-muted">G$</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-bold uppercase tracking-wider text-muted block mb-1">Clue</label>
                          <input
                            type="text"
                            value={stop.clue}
                            onChange={(e) => updateStop(idx, "clue", e.target.value.slice(0, 120))}
                            placeholder={isFinal ? "You found it! 🎉" : "Near the red door…"}
                            className="w-full border-2 border-ink rounded-xl px-3 py-2 text-sm bg-transparent outline-none placeholder:text-muted"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add stop */}
              {stops.length < MAX_STOPS && (
                <button
                  onClick={addStop}
                  className="w-full border-2 border-dashed border-ink rounded-2xl py-3 flex items-center justify-center gap-2 font-bold text-sm text-muted hover:bg-border hover:text-ink transition-colors"
                >
                  <Plus size={16} />
                  Add stop {stops.length < MAX_STOPS ? `(max ${MAX_STOPS})` : ""}
                </button>
              )}

              {/* Expiry */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted">All stops expire in</label>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.seconds}
                      onClick={() => setDuration(d.seconds)}
                      className={clsx(
                        "px-4 py-2 rounded-lg border-2 border-ink text-sm font-bold transition-all",
                        duration === d.seconds ? "bg-lime shadow-brutal-sm" : "bg-cream hover:bg-border"
                      )}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              {/* Cost summary */}
              {isConnected && !isFetching && (
                <div className={clsx(
                  "rounded-xl px-4 py-3 flex items-center justify-between text-sm",
                  insufficientBalance ? "bg-danger/10 border-2 border-danger" : "bg-lime/20 border-2 border-ink"
                )}>
                  <span className="font-semibold text-muted">Total cost</span>
                  <div className="text-right">
                    <p className="font-black">{formatG$(totalWei)} G$</p>
                    <p className={clsx("text-xs", insufficientBalance ? "text-danger" : "text-muted")}>
                      {insufficientBalance ? `Only ${formatG$(balance)} G$ available` : `Balance: ${formatG$(balance)} G$`}
                    </p>
                  </div>
                </div>
              )}

              {/* Error */}
              {(status === "error" || errMsg) && (
                <div className="bg-danger/10 border-2 border-danger rounded-xl px-4 py-3 text-sm text-danger font-semibold">
                  {errMsg || "Something went wrong."}
                </div>
              )}

              {/* Deploy CTA */}
              <button
                onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handleDeploy}
                disabled={busy || (status !== "error" && !canDeploy)}
                className={clsx(
                  "btn-brutal w-full py-4 rounded-xl font-black text-base flex items-center justify-center gap-2",
                  canDeploy || status === "error"
                    ? "bg-lime text-ink cursor-pointer"
                    : "bg-border text-muted cursor-not-allowed shadow-none"
                )}
                style={!(canDeploy || status === "error") ? { boxShadow: "none", transform: "none" } : {}}
              >
                {status === "approving" && <><Loader2 size={16} className="animate-spin" /> Approving G$ transfer…</>}
                {status === "deploying" && <><Loader2 size={16} className="animate-spin" /> Creating stop {progress.current} of {progress.total}…</>}
                {status === "error" && "Try again"}
                {status === "idle" && (canDeploy
                  ? `🔗 Deploy ${stops.length}-Stop Hunt — ${formatG$(totalWei)} G$`
                  : stops.some((s) => s.lat === null) ? "Choose all locations first"
                  : "Complete all stops to deploy"
                )}
              </button>
              <p className="text-center text-xs text-muted">
                Hunters follow the chain — each stop reveals the next clue
              </p>
            </>
          )}
        </div>
      </motion.div>

      {/* Location picker — slides over the chain sheet */}
      {pickingIdx !== null && (
        <LocationPickerSheet
          open={pickingIdx !== null}
          initialCenter={
            stops[pickingIdx]?.lat !== null
              ? { lat: stops[pickingIdx].lat!, lng: stops[pickingIdx].lng! }
              : userLocation
          }
          currentLocation={userLocation}
          onConfirm={(lat, lng, place) => handleLocationConfirm(pickingIdx, lat, lng, place)}
          onClose={() => setPickingIdx(null)}
        />
      )}
    </>
  );
}
