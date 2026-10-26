"use client";
import { useState, useMemo } from "react";
import { useSignMessage } from "wagmi";
import { Check, Pencil, ExternalLink, Lightbulb } from "lucide-react";
import { useLandmarks } from "@/hooks/useLandmarks";
import { UserHandle } from "@/components/UserHandle";
import { updateLandmark, deleteLandmark } from "@/lib/landmarkClient";
import { landmarkMeta } from "@/lib/landmarks";
import type { Landmark } from "@/types";
import { AdminPage, Button, Card, CountBadge, EmptyState, Hint, RowsSkeleton, landmarkIcon, timeAgo } from "./ui";
import { LandmarkEditSheet, landmarkErr } from "./LandmarkEditSheet";

/** Admin · Suggestions — places proposed by hunters, waiting for a decision. */
export function SuggestionsBody() {
  const { landmarks, loading, refresh } = useLandmarks("all");
  const { signMessageAsync } = useSignMessage();
  const sign = (m: string) => signMessageAsync({ message: m });

  const [busyId, setBusyId]         = useState<string | null>(null);
  const [confirmRej, setConfirmRej] = useState<string | null>(null);
  const [editing, setEditing]       = useState<Landmark | null>(null);
  const [err, setErr]               = useState("");

  const pending = useMemo(
    () => landmarks.filter((l) => l.status === "pending").sort((a, b) => b.createdAt - a.createdAt),
    [landmarks],
  );

  function announce() {
    // Keeps the sidebar badge + the live map in sync after any decision.
    window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
  }

  async function approve(l: Landmark) {
    setBusyId(l.id); setErr("");
    try {
      await updateLandmark(sign, l.id, { status: "active" });
      announce();
      await refresh();
    } catch (e) { const m = landmarkErr(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }
  async function reject(id: string) {
    setBusyId(id); setErr("");
    try {
      await deleteLandmark(sign, id);
      setConfirmRej(null);
      announce();
      await refresh();
    } catch (e) { const m = landmarkErr(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }

  return (
    <AdminPage
      title={<>Suggestions <CountBadge n={pending.length} /></>}
      subtitle="Places suggested by verified hunters. Approve to put them on the map, or reject to discard."
    >
      <Hint text={err} tone="bad" className="mb-3" />

      {loading ? (
        <RowsSkeleton count={3} height="h-40" />
      ) : pending.length === 0 ? (
        <Card><EmptyState icon={Lightbulb} title="All caught up" body="No suggestions waiting for review." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {pending.map((l) => {
            const meta = landmarkMeta(l.category);
            const Icon = landmarkIcon(l.category);
            const busy = busyId === l.id;
            const mapsUrl = `https://www.google.com/maps?q=${l.lat},${l.lng}`;
            return (
              <Card key={l.id} className={`motion-safe:transition-opacity ${busy ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3 min-w-0">
                  <span className="w-11.5 h-11.5 rounded-full bg-surface flex items-center justify-center text-heading shrink-0">
                    <Icon className="w-5 h-5" strokeWidth={1.75} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg/[120%] text-heading break-words">{l.name}</p>
                    <p className="text-sm/none text-nav-muted mt-2">{meta.label} · suggested {timeAgo(l.createdAt)}</p>
                  </div>
                </div>

                {l.note && (
                  <p className="text-sm/[140%] text-nav-muted bg-surface rounded-2xl px-4 py-3 mt-4">&ldquo;{l.note}&rdquo;</p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-sm/none text-nav-muted">
                  <button
                    type="button"
                    onClick={() => window.open(`/?focus=${l.lat},${l.lng}`, "_blank", "noopener")}
                    className="inline-flex items-center gap-1.5 text-heading cursor-pointer hover:text-brand motion-safe:transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" strokeWidth={2} /> Preview on map
                  </button>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                    Google Maps
                  </a>
                  <span className="inline-flex items-center gap-1 min-w-0">
                    {l.lat.toFixed(4)}, {l.lng.toFixed(4)} · by <UserHandle address={l.createdBy} className="text-heading" />
                  </span>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-4">
                  <Button variant="primary" onClick={() => approve(l)} busy={busy && confirmRej !== l.id} className="flex-1">
                    {!busy && <Check className="w-4 h-4" strokeWidth={2} />} Approve
                  </Button>
                  <Button onClick={() => { setEditing(l); setErr(""); }} disabled={busy} aria-label="Edit suggestion">
                    <Pencil className="w-4 h-4" strokeWidth={2} /> <span className="hidden sm:inline">Edit</span>
                  </Button>
                  {confirmRej === l.id ? (
                    <Button variant="danger" onClick={() => reject(l.id)} busy={busy}>Confirm</Button>
                  ) : (
                    <Button variant="danger" onClick={() => { setConfirmRej(l.id); setErr(""); }} disabled={busy}>Reject</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <LandmarkEditSheet
          landmark={editing}
          title="Tidy up before approving"
          subtitle="Saving keeps it in the queue. Approve from the list after."
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); announce(); refresh(); }}
        />
      )}
    </AdminPage>
  );
}
