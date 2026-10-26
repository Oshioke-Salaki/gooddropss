"use client";
import { useState, useCallback } from "react";
import { useWriteContract, useReadContract } from "wagmi";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { parseUnits, maxUint256 } from "viem";
import { decodeEventLog } from "viem";
import { Plus, Trash2, Loader2, Copy, Check, Trophy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI,
  G_TOKEN_ADDRESS, ERC20_ABI,
} from "@/lib/contracts";
import {
  degToGps, formatG$, haversineDistance,
  buildChainHint, buildPrivateChainHint, buildChainLastHint,
} from "@/lib/utils";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { Sheet } from "@/components/ui/Sheet";
import { DropLocationCard } from "@/components/drop/DropLocationCard";
import { Card, Label, TextField } from "@/components/drop/controls";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { useLandmarks } from "@/hooks/useLandmarks";
import { useProfile } from "@/hooks/useProfile";
import { addLandmarkClue, LANDMARK_CLUE_RADIUS_M } from "@/lib/landmarks";
import type { ChainStop, Landmark } from "@/types";
import { track } from "@/lib/analytics";

const CHAIN_CLUE_MAX = 120;

// Active landmarks within clue range of a stop, nearest first (max 4).
function nearbyLandmarksFor(landmarks: Landmark[], lat: number | null, lng: number | null): Landmark[] {
  if (lat === null || lng === null) return [];
  return landmarks
    .filter((l) => l.status === "active" && Number.isFinite(l.lat) && Number.isFinite(l.lng))
    .map((l) => ({ l, d: haversineDistance(lat, lng, l.lat, l.lng) }))
    .filter(({ d }) => d <= LANDMARK_CLUE_RADIUS_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map(({ l }) => l);
}

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

// Amounts come from a free-text field, so a half-typed ".5" or "1." reaches
// here. parseUnits throws on those, and this runs during render — degrade to 0n.
function toWei(amount: string): bigint {
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return 0n;
  const [whole = "", frac = ""] = amount.split(".");
  try { return parseUnits(`${whole || "0"}.${frac.slice(0, 18) || "0"}`, 18); } catch { return 0n; }
}

const CTA =
  "w-full cursor-pointer rounded-full bg-nav-active px-5 py-5 text-base/none text-white " +
  "flex items-center justify-center gap-2 motion-safe:transition-opacity hover:opacity-90 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const SECONDARY =
  "w-full h-12 cursor-pointer rounded-full border border-line bg-white text-sm/none text-heading " +
  "flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-surface";

/**
 * Drop Chain — a multi-stop hunt where each stop's clue unlocks the next.
 *
 * Stops are deployed in REVERSE so each one can embed the id of the stop after
 * it; only the first is public on the map. The sheet is the shared `Sheet`
 * container; the location picker is a full-screen surface that stacks above it
 * (z 1450 > 1400), so the sheet just goes non-dismissible while it's up.
 */
export function ChainDropCreator({ open, userLocation, onClose, onSuccess }: Props) {
  const { address, isConnected }  = useSignedInAccount();
  const { writeContractAsync }    = useWriteContract();
  const { balance, isFetching }   = useGoodDollarProfile();
  const { landmarks }             = useLandmarks();
  const profile = useProfile(address);
  const hasUsername = !!profile?.username;
  // Dropping is identity-gated (see drop/useCreateDrop) — chain hunts are no exception.
  const {
    isVerified, isLapsed, isLoading: identityLoading, checkFailed: identityCheckFailed,
  } = useIdentityStatus();

  // Per-drop limits from the contract (each stop must be in range, not just the total).
  const { data: maxDropWei } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "maxDropAmount" });
  const { data: minDropWei } = useReadContract({ address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "minDropAmount" });
  const maxDrop = (maxDropWei as bigint | undefined) ?? parseUnits("500", 18);
  const minDrop = (minDropWei as bigint | undefined) ?? parseUnits("1", 18);

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

  const handleClose = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

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

  const totalWei = stops.reduce((s, stop) => s + toWei(stop.amount), 0n);

  const insufficientBalance = isConnected && !isFetching && totalWei > 0n && totalWei > balance;

  const amtInRange = (amt: string): boolean => {
    const w = toWei(amt);
    return w > 0n && w >= minDrop && w <= maxDrop;
  };
  const outOfRange = stops.some((s) => toWei(s.amount) > 0n && !amtInRange(s.amount));

  const canDeploy =
    isConnected &&
    hasUsername &&
    // Verified, or the check hasn't resolved yet (don't false-block on load/RPC fail).
    (isVerified || identityLoading || identityCheckFailed) &&
    stops.length >= 2 &&
    stops.every((s) => s.lat !== null && s.lng !== null && amtInRange(s.amount)) &&
    !insufficientBalance &&
    status === "idle";

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

      // Keep expiry safely inside the contract window [now+minExpiryDuration,
      // now+maxExpiryDuration] despite mining latency / device-clock skew: pad the
      // lower bound (the "1h" option sits on the floor) and cap under the ceiling.
      // See drop/useCreateDrop for the full rationale (a naive "+120" overflowed 30d).
      const SKEW = 300;
      const nowSec = Math.floor(Date.now() / 1000);
      const maxDuration = Math.max(...DURATIONS.map((d) => d.seconds));
      const expiry = Math.min(nowSec + duration + SKEW, nowSec + maxDuration - SKEW);
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

        const amountWei = toWei(stop.amount);
        const tx = await writeContractAsync({
          address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI,
          functionName: "createDrop",
          args: [
            degToGps(stop.lat!),
            degToGps(stop.lng!),
            amountWei,
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
      window.dispatchEvent(new CustomEvent("gd:drop-created"));
      track("drop_created", { kind: "chain", count: stops.length });
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

  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => { /* clipboard blocked — the link is on screen */ });
  };

  if (!open) return null;

  const identityBlocked = isConnected && hasUsername && !identityLoading && !isVerified;
  const missingLocation = stops.some((s) => s.lat === null);

  const ctaLabel =
    status === "approving"  ? "Approving G$…" :
    status === "deploying"  ? `Creating stop ${progress.current} of ${progress.total}…` :
    status === "error"      ? "Try again" :
    canDeploy               ? `Deploy ${stops.length}-stop hunt — ${formatG$(totalWei)} G$` :
    missingLocation         ? "Choose every location first" :
    "Complete every stop to deploy";

  return (
    <>
      <Sheet
        title={status === "done" ? "Hunt chain is live" : "Create a hunt chain"}
        onClose={status === "done" ? () => { onSuccess(); reset(); } : handleClose}
        // The picker sits on top of this sheet; Escape and taps must not reach us
        // while it's open, and nothing may close mid-deploy.
        dismissible={!busy && pickingIdx === null}
        width={500}
      >
        {status === "done" && shareUrl ? (
          /* ── Done ───────────────────────────────────────────────────────── */
          <div className="space-y-6 pt-6">
            <div className="flex flex-col items-center text-center gap-y-4">
              <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
                <Check className="w-7 h-7" />
              </span>
              <p className="text-sm/[140%] text-nav-muted">
                {stops.length} stops linked, {formatG$(totalWei)} G$ in rewards. Share the entry
                link to start hunters on the chain — each stop reveals the next.
              </p>
            </div>

            <Card className="p-6 flex flex-col items-center gap-y-6">
              <QRCodeSVG
                value={shareUrl}
                level="M"
                className="h-auto w-full max-w-[200px]"
                style={{ aspectRatio: "1 / 1", height: "auto" }}
              />
              <div className="flex w-full items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm/none text-heading" title={shareUrl}>
                  {shareUrl}
                </p>
                <button
                  type="button"
                  onClick={copyLink}
                  aria-label="Copy entry link"
                  className="shrink-0 w-10 h-10 rounded-full bg-surface flex items-center justify-center cursor-pointer
                    text-nav-active motion-safe:transition-colors hover:bg-nav-controls"
                >
                  {linkCopied ? <Check className="w-5 h-5 text-brand" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </Card>

            <button type="button" onClick={() => { onSuccess(); reset(); }} className={CTA}>
              Done
            </button>
          </div>
        ) : (
          /* ── Form ───────────────────────────────────────────────────────── */
          <div className="space-y-6 pt-6">
            <p className="text-sm/[140%] text-nav-muted">
              Link 2–{MAX_STOPS} stops. Only the first shows on the map; every stop reveals the
              next, and the first hunter to finish takes the final reward.
            </p>

            {/* ── Stops ── */}
            <div className="space-y-4">
              {stops.map((stop, idx) => {
                const isFinal = idx === stops.length - 1;
                const nearby = nearbyLandmarksFor(landmarks, stop.lat, stop.lng);
                return (
                  <Card key={idx} className="p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm/none
                            ${isFinal ? "bg-brand text-white" : "bg-surface text-heading"}`}
                        >
                          {isFinal ? <Trophy className="w-4 h-4" strokeWidth={2} /> : idx + 1}
                        </span>
                        <span className="truncate text-base/none text-heading">
                          {isFinal ? "Final reward" : `Stop ${idx + 1}`}
                        </span>
                        {idx === 0 && (
                          <span className="shrink-0 rounded-full bg-brand-soft px-3 py-1.5 text-xs/none text-brand">
                            Public entry
                          </span>
                        )}
                      </div>
                      {stops.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeStop(idx)}
                          disabled={busy}
                          aria-label={`Remove stop ${idx + 1}`}
                          className="w-9 h-9 shrink-0 rounded-full bg-surface flex items-center justify-center cursor-pointer
                            text-nav-muted motion-safe:transition-colors hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <DropLocationCard
                      lat={stop.lat}
                      lng={stop.lng}
                      placeName={stop.place}
                      isPrivate={false}
                      hasRiddle={false}
                      onPick={() => setPickingIdx(idx)}
                      disabled={busy}
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[136px_1fr]">
                      <div>
                        <Label>{isFinal ? "Jackpot" : "Amount"}</Label>
                        <TextField
                          inputMode="decimal"
                          value={stop.amount}
                          disabled={busy}
                          placeholder="0.00"
                          suffix="G$"
                          aria-label={isFinal ? "Final reward amount" : `Stop ${idx + 1} amount`}
                          // Digits and a single dot only — the value is parsed with parseUnits.
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
                            updateStop(idx, "amount", v);
                          }}
                        />
                      </div>
                      <div>
                        <Label hint={`${stop.clue.length}/${CHAIN_CLUE_MAX}`}>Clue</Label>
                        <TextField
                          value={stop.clue}
                          disabled={busy}
                          maxLength={CHAIN_CLUE_MAX}
                          placeholder={isFinal ? "Look under the bench" : "Near the red door"}
                          aria-label={`Stop ${idx + 1} clue`}
                          onChange={(e) => updateStop(idx, "clue", e.target.value.slice(0, CHAIN_CLUE_MAX))}
                        />
                      </div>
                    </div>

                    {/* Nearby landmarks → one-tap clue anchors for this stop */}
                    {nearby.length > 0 && (
                      <div className="no-scrollbar flex gap-2 overflow-x-auto">
                        {nearby.map((l) => {
                          const added = stop.clue.toLowerCase().includes(l.name.toLowerCase());
                          return (
                            <button
                              key={l.id}
                              type="button"
                              disabled={added || busy}
                              onClick={() => updateStop(idx, "clue", addLandmarkClue(stop.clue, l.name, CHAIN_CLUE_MAX))}
                              className={`shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs/none cursor-pointer
                                motion-safe:transition-colors
                                ${added ? "bg-brand-soft text-brand cursor-default" : "bg-surface text-heading hover:bg-nav-controls"}`}
                            >
                              {added && <Check className="w-3 h-3" />}
                              <span className="max-w-[120px] truncate">Near {l.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {stops.length < MAX_STOPS && (
              <button type="button" onClick={addStop} disabled={busy} className={`${SECONDARY} disabled:opacity-40`}>
                <Plus className="w-4 h-4" strokeWidth={2} />
                Add a stop
                <span className="text-nav-muted">· up to {MAX_STOPS}</span>
              </button>
            )}

            {/* ── Expiry ── */}
            <Card className="p-6">
              <p className="mb-4 text-sm/none text-nav-muted">All stops expire in</p>
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
                      className={`flex-1 cursor-pointer rounded-full border py-4 text-sm/none motion-safe:transition-colors
                        ${active ? "border-brand bg-brand text-white" : "border-line text-heading hover:bg-surface"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* ── Cost ── */}
            {isConnected && !isFetching && (
              <Card className="p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="mb-2 text-sm/none text-nav-muted">Total</p>
                  <p className="text-lg/none text-heading">{formatG$(totalWei)} G$</p>
                </div>
                <div className="text-right">
                  <p className="mb-2 text-sm/none text-nav-muted">Your balance</p>
                  <p className={`text-lg/none ${insufficientBalance ? "text-danger" : "text-heading"}`}>
                    {formatG$(balance)} G$
                  </p>
                </div>
              </Card>
            )}

            {/* ── Problems — one slot, so the layout never jumps ── */}
            <p role="status" aria-live="polite" className="min-h-4 text-center text-sm/[140%] text-danger">
              {status === "error" || errMsg
                ? (errMsg || "Something went wrong.")
                : outOfRange
                  ? `Each stop must be between ${formatG$(minDrop)} and ${formatG$(maxDrop)} G$.`
                  : insufficientBalance
                    ? `Not enough G$ — you have ${formatG$(balance)} G$.`
                    : ""}
            </p>

            {/* ── Gates — drops must be attributable to a verified, named human ── */}
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
                {busy && <Loader2 className="w-5 h-5 animate-spin" />}
                {ctaLabel}
              </button>
              <p className="text-center text-xs/[150%] text-nav-muted">
                Hunters follow the chain — each stop reveals the next clue.
              </p>
            </div>
          </div>
        )}
      </Sheet>

      {/* Location picker — a full-screen surface above the sheet */}
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
          landmarks={landmarks}
        />
      )}
    </>
  );
}
