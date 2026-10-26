"use client";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { draftDigest, eventMessage, type GdEvent } from "@/lib/events";
import { announceEventsChanged } from "./useEvents";

/**
 * Cancel an event — signed, final. Explains what happens to drops already
 * placed, since that's the question every organizer has at this moment.
 */
export function CancelEventSheet({ event, address, onClose, onCancelled }: {
  event: GdEvent;
  address: string;
  onClose: () => void;
  onCancelled?: (e: GdEvent) => void;
}) {
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const started = Math.floor(Date.now() / 1000) >= event.startsAt;

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const timestamp = Date.now();
      const signature = await signMessageAsync({ message: eventMessage("cancel", event.id, timestamp, draftDigest(null)) });
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", address, signature, timestamp }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? "Couldn't cancel. Try again."); return; }
      announceEventsChanged();
      onCancelled?.(body.event as GdEvent);
      onClose();
    } catch (e) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "";
      if (!/reject|denied|cancel/i.test(m)) setError("Couldn't cancel. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Cancel this event?" onClose={onClose} dismissible={!busy} zIndex={1450} width={460}>
      <div className="pt-5 flex flex-col gap-4">
        <p className="text-base/[1.4] text-heading">{event.title}</p>
        <ul className="rounded-2xl bg-surface p-4 flex flex-col gap-2.5 text-sm/[145%] text-heading list-disc pl-8">
          <li>It comes off the Events page. Anyone with the link sees that it was cancelled.</li>
          {started ? (
            <li>Drops already out stay claimable until they expire.</li>
          ) : (
            <li>Drops you&apos;ve already placed stay locked. Once they expire, reclaim your G$ from My Drops.</li>
          )}
          <li>This can&apos;t be undone. You can submit a new event any time.</li>
        </ul>
        <p className="min-h-5 text-sm/none text-danger" role="alert">{error}</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onClose} disabled={busy}
            className="h-12 rounded-full bg-surface text-sm/none text-heading cursor-pointer hover:bg-nav-controls disabled:opacity-50">
            Keep event
          </button>
          <button type="button" onClick={cancel} disabled={busy}
            className="h-12 rounded-full bg-danger text-white text-sm/none flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 disabled:opacity-60">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling…</> : "Cancel event"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
