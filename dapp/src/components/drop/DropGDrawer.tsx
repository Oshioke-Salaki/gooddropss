"use client";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useSheetDrag } from "@/hooks/useSheetDrag";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { useCreateDrop, DURATIONS, MAX_MULTI } from "./useCreateDrop";
import { DropLocationCard } from "./DropLocationCard";
import { DropSuccessModal } from "./DropSuccessModal";
import { Card, FeatureCard, Label, Stepper, TextField } from "./controls";
import { RIDDLE_MAX_ANSWER, RIDDLE_MAX_QUESTION } from "@/lib/riddles";
import { formatG$ } from "@/lib/utils";
import { CLAIM_RADIUS_M } from "@/lib/contracts";
import { addLandmarkClue } from "@/lib/landmarks";

interface Props {
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  onSuccess: () => void;
  campaignId?: string;
  campaignName?: string;
  claimPoints?: { lat: number; lng: number }[];
  /** Fly the map behind to a point (the new drop). */
  onViewOnMap?: (lat: number, lng: number) => void;
  /** Drops for an event: tagged [E:id], public only, starting at the venue. */
  eventId?: string;
  eventName?: string;
  eventVenue?: { lat: number; lng: number; name: string } | null;
}

/**
 * Drop G$ — a right-hand drawer on desktop, a draggable bottom sheet on mobile.
 *
 * Mounted only while open, deliberately: useSheetDrag animates in on MOUNT, so a
 * permanently-mounted drawer would play its entrance once at page load and then
 * appear instantly forever after. Unmounting also disposes the preview map's GL
 * context and resets the form for free.
 *
 * Layout only: every rule about what may be dropped, and the whole approve →
 * createDrop → bind-riddle sequence, lives in useCreateDrop.
 */
export function DropGDrawer({
  userLocation, onClose, onSuccess, campaignId, campaignName, claimPoints = [], onViewOnMap,
  eventId, eventName, eventVenue = null,
}: Props) {
  const d = useCreateDrop({
    campaignId, eventId, claimPoints, onClose,
    defaultLocation: eventVenue ? { lat: eventVenue.lat, lng: eventVenue.lng, placeName: eventVenue.name } : null,
  });
  const sheet = useSheetDrag({ onDismiss: d.handleClose });
  const { sheetRef, sheetStyle, handleProps } = sheet;

  // Closing has to be animated, not just unmounted. On mobile the sheet hook
  // already owns an exit (it slides the sheet back down); on desktop it's inert,
  // so the drawer plays a CSS exit and unmounts when that finishes.
  const [exiting, setExiting] = useState(false);
  const requestClose = useCallback(() => {
    if (exiting) return;
    if (sheet.enabled) { sheet.close(); return; }
    setExiting(true);
    window.setTimeout(d.handleClose, 240);
  }, [exiting, sheet, d.handleClose]);

  // Tell the map to refetch once, the moment a drop lands.
  useEffect(() => {
    if (d.status === "done") onSuccess();
    // onSuccess closes over fresh state each render; depending on it would re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.status]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the picker owns the screen, Escape belongs to it.
      // Once the success modal is up it owns Escape — otherwise both would fire
      // and close() would run twice.
      if (e.key === "Escape" && !d.pickerOpen && !d.busy && d.status !== "done") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // The hook returns a fresh object each render — depending on `d` would detach
    // and reattach the listener on every keystroke in the form.
  }, [d.pickerOpen, d.busy, d.status, requestClose]);

  if (typeof document === "undefined") return null;

  // The job has changed from "configure a drop" to "share it", so the drawer
  // steps aside entirely rather than swapping its own body.
  if (d.status === "done") {
    return (
      <DropSuccessModal
        amount={d.amount}
        amountWei={d.amountWei}
        qty={d.multiProgress?.done ?? d.qty}
        placeName={d.placeName}
        isPrivate={d.isPrivate}
        shareUrl={d.shareUrl}
        resuming={d.resuming}
        onShare={d.handleShare}
        onClose={d.handleClose}
        durationSeconds={d.resuming ? undefined : d.duration}
        onViewOnMap={onViewOnMap && d.lat != null && d.lng != null ? () => onViewOnMap(d.lat as number, d.lng as number) : undefined}
      />
    );
  }

  const identityBlocked =
    !d.identityLoading && !d.identityCheckFailed && !d.isVerified;

  return createPortal(
    <>
      {/* The picker takes the whole screen; hide the drawer under it rather than
          stacking two sheets. */}
      <div className={d.pickerOpen ? "hidden" : ""}>
        <div
          onClick={d.busy ? undefined : requestClose}
          className={`${exiting ? "modal-fade-out" : "modal-fade-in"} fixed inset-0 z-[1400] flex items-end justify-center bg-[#0000000A] font-sans backdrop-blur-md
            lg:items-stretch lg:justify-end lg:p-5`}
        >
          <div
            ref={sheetRef}
            style={sheetStyle}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Drop G$"
            className={`${exiting ? "drawer-out-lg" : "drawer-in-lg"} relative flex w-full max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl bg-white
              shadow-[0px_0px_12px_0px_#0000000A]
              lg:max-h-none lg:w-[500px] lg:max-w-[calc(100vw-40px)] lg:rounded-3xl`}
          >
            {/* Header — doubles as the drag handle on mobile. */}
            <div {...handleProps} className="shrink-0 px-6 pb-6 pt-6">
              <span
                aria-hidden
                className="mx-auto mb-4 block h-1 w-9 rounded-full bg-line lg:hidden"
              />
              <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="mb-5 text-xl/none text-heading">
                  {campaignName ? `Drop for ${campaignName}` : "Drop G$"}
                </h2>
                {eventId ? (
                  <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-brand-soft px-3 py-2 text-sm/none text-brand">
                    <CalendarDays className="h-4 w-4 shrink-0" strokeWidth={2} />
                    <span className="truncate">For {eventName ?? "your event"}</span>
                  </span>
                ) : (
                  <p className="text-sm/none text-nav-muted">Hide money anywhere in the world</p>
                )}
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close"
                className="shrink-0 cursor-pointer rounded-full bg-surface p-1.5 text-nav-muted motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
              >
                <X size={14} />
              </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {d.pending ? (
                /* A drop from an earlier attempt is on-chain, escrowed, and
                   unclaimable until its riddle binds. Nothing else may happen
                   until this is resolved, or the G$ stays locked forever. */
                <div className="space-y-4 p-6">
                  <Card className="space-y-4 p-6">
                    <h3 className="text-base/none text-heading">Finish your riddle drop</h3>
                    <p className="text-sm/[150%] text-nav-muted">
                      A drop is already hidden but its riddle never attached, so nobody can
                      claim it yet. Finishing needs no signature and costs nothing.
                    </p>
                    {d.errMsg && <p className="text-sm/[150%] text-danger">{d.errMsg}</p>}
                    <button
                      type="button"
                      onClick={d.resumePending}
                      disabled={d.busy}
                      className="w-full cursor-pointer rounded-full bg-nav-active px-5 py-5 text-base/none text-white disabled:opacity-60"
                    >
                      {d.busy ? "Finishing…" : "Finish it"}
                    </button>
                    <button
                      type="button"
                      onClick={d.discardPending}
                      disabled={d.busy}
                      className="w-full cursor-pointer py-2 text-sm/none text-nav-muted hover:text-heading"
                    >
                      Abandon this drop
                    </button>
                  </Card>
                </div>
              ) : (
                <>
                  <div className="space-y-6 p-6 pb-[calc(24px+env(safe-area-inset-bottom,0px))]">
                    <DropLocationCard
                      lat={d.lat}
                      lng={d.lng}
                      placeName={d.placeName}
                      isPrivate={d.isPrivate}
                      hasRiddle={d.hasRiddle}
                      onPick={() => d.setPickerOpen(true)}
                      disabled={d.busy}
                    />

                    {/* Local demand — "hunters are active here" beats guessing. */}
                    {d.lat !== null && (
                      <p className="-mt-2 text-sm/[150%] text-nav-muted">
                        {d.nearbyDemand > 0
                          ? `${d.nearbyDemand} drop${d.nearbyDemand === 1 ? "" : "s"} claimed near here — hunters are active.`
                          : "No claims near here yet — you'd be starting a fresh hotspot."}
                      </p>
                    )}

                    {/* ── Amount ── */}
                    <div>
                      <Label hint={`Min ${d.minG} G$ · Max ${d.maxG} G$`}>Amount</Label>
                      <TextField
                        inputMode="decimal"
                        value={d.amount}
                        disabled={d.busy}
                        placeholder="0.00"
                        suffix="G$"
                        aria-label="Amount to drop"
                        // Digits and a single dot only: the value is parsed with
                        // parseUnits, which throws on anything else.
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
                          d.setAmount(v);
                        }}
                      />
                      {d.overMax && (
                        <p className="mt-2 text-sm/[150%] text-danger">
                          Maximum drop is {formatG$(d.maxDrop)} G$.
                        </p>
                      )}
                      {d.underMin && (
                        <p className="mt-2 text-sm/[150%] text-danger">
                          Minimum drop is {formatG$(d.minDrop)} G$.
                        </p>
                      )}
                      {d.insufficientBalance && (
                        <p className="mt-2 text-sm/[150%] text-danger">
                          Not enough G$ — you have {formatG$(d.balance)} G$.
                        </p>
                      )}
                    </div>

                    {/* ── Quantity + expiry ── */}
                    <Card>
                      <div className="border-b border-line p-6">
                        <h3 className="mb-3 text-base/none text-heading">How many drops</h3>
                        <p className="mb-5 text-sm/none text-nav-muted">
                          Drop more than one at this spot
                        </p>
                        <Stepper
                          value={d.quantity}
                          onChange={d.setQuantity}
                          min={1}
                          max={MAX_MULTI}
                          disabled={d.busy || !!campaignId}
                        />
                        {d.multiActive && (
                          <p className="mt-3 text-sm/[150%] text-nav-muted">
                            {d.qty} drops of {d.amount || "?"} G$ — {formatG$(d.totalWei)} G$ total,
                            scattered within {CLAIM_RADIUS_M}m. Private and riddle drops are
                            one-at-a-time.
                          </p>
                        )}
                      </div>

                      <div className="p-6">
                        <p className="mb-4 text-sm/none text-nav-muted">Expires in</p>
                        <div className="flex items-center gap-2">
                          {DURATIONS.map(({ label, seconds }) => {
                            const active = d.duration === seconds;
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() => d.setDuration(seconds)}
                                disabled={d.busy}
                                aria-pressed={active}
                                className={`flex-1 cursor-pointer rounded-full border py-4 text-sm/none motion-safe:transition-colors
                                  ${active
                                    ? "border-brand bg-brand text-white"
                                    : "border-line text-heading hover:bg-surface"}`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </Card>

                    {/* ── Clue ── */}
                    <div>
                      <Label hint={`${d.hint.length}/${d.hintMaxLen}`}>Clue</Label>
                      <TextField
                        value={d.hint}
                        disabled={d.busy}
                        maxLength={d.hintMaxLen}
                        placeholder="Give the hunter a clue of where to look"
                        aria-label="Clue"
                        onChange={(e) => d.setHint(e.target.value)}
                      />
                      {d.nearbyLandmarks.length > 0 && (
                        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
                          {d.nearbyLandmarks.map((l) => (
                            <button
                              key={l.id}
                              type="button"
                              disabled={d.busy}
                              onClick={() => d.setHint(addLandmarkClue(d.hint, l.name, d.hintMaxLen))}
                              className="shrink-0 cursor-pointer rounded-full bg-surface px-4 py-2 text-xs/none text-heading motion-safe:transition-colors hover:bg-nav-controls"
                            >
                              Near {l.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── Private ── (event drops are always public) */}
                    {!eventId && (
                    <FeatureCard
                      iconSrc="/lock-password-fill-icon.svg"
                      title="Private drop"
                      blurb="Share the link to recipient"
                      checked={d.isPrivate}
                      onChange={d.setIsPrivate}
                      disabled={d.busy || d.multiActive || !!campaignId}
                    >
                      <div>
                        <Label>Recipient address (Optional)</Label>
                        <TextField
                          value={d.targetAddress}
                          disabled={d.busy}
                          placeholder="0x..."
                          aria-label="Recipient address"
                          onChange={(e) => d.setTargetAddress(e.target.value)}
                        />
                      </div>
                    </FeatureCard>
                    )}

                    {/* ── Riddle ── */}
                    <FeatureCard
                      iconSrc="/question-dropper-icon.svg"
                      title="Riddle drop"
                      blurb="Hunters must answer correctly to claim"
                      checked={d.hasRiddle}
                      onChange={d.setHasRiddle}
                      disabled={d.busy || d.multiActive}
                    >
                      <div>
                        <Label>Question</Label>
                        <TextField
                          value={d.riddleQuestion}
                          disabled={d.busy}
                          maxLength={RIDDLE_MAX_QUESTION}
                          placeholder="e.g. The Sun is pale when?"
                          aria-label="Riddle question"
                          onChange={(e) => d.setRiddleQuestion(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Answer</Label>
                        <TextField
                          value={d.riddleAnswer}
                          disabled={d.busy}
                          maxLength={RIDDLE_MAX_ANSWER}
                          placeholder="Enter answer here..."
                          aria-label="Riddle answer"
                          onChange={(e) => d.setRiddleAnswer(e.target.value)}
                        />
                      </div>
                      <p className="text-xs/[150%] text-nav-muted">
                        Capitals, spaces and punctuation are ignored — “The Red Bench!” matches
                        “red bench”.
                      </p>
                      {d.answerLeaked && (
                        <p className="text-xs/[150%] text-streak">
                          Your clue contains the answer — the clue is public, so anyone can read it.
                        </p>
                      )}
                    </FeatureCard>

                    {/* ── Submit ── */}
                    <div className="space-y-3 text-center">
                      {d.errMsg && <p className="text-sm/[150%] text-danger">{d.errMsg}</p>}
                      {!d.hasUsername && d.isConnected && (
                        <p className="text-sm/[150%] text-nav-muted">
                          Set a username before dropping.
                        </p>
                      )}
                      {identityBlocked && (
                        <p className="text-sm/[150%] text-nav-muted">
                          {d.isLapsed
                            ? "Re-verify your GoodDollar identity to drop."
                            : "Verify your GoodDollar identity to drop."}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={d.handleDrop}
                        disabled={!d.canDrop}
                        className="w-full cursor-pointer rounded-full bg-nav-active px-5 py-5 text-base/none text-white
                          motion-safe:transition-opacity hover:opacity-90
                          disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {d.btnLabel}
                      </button>
                      <p className="text-xs/[150%] text-nav-muted">
                        Hunters within {CLAIM_RADIUS_M}m can claim this drop
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <LocationPickerSheet
        open={d.pickerOpen}
        initialCenter={d.lat !== null && d.lng !== null ? { lat: d.lat, lng: d.lng } : userLocation}
        currentLocation={userLocation}
        landmarks={d.landmarks}
        onConfirm={d.handleLocationConfirm}
        onClose={() => d.setPickerOpen(false)}
      />
    </>,
    document.body,
  );
}

export default DropGDrawer;
