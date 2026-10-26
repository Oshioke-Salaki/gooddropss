"use client";
import { useState, useMemo } from "react";
import { useSignMessage } from "wagmi";
import { Search, X, MapPin, Eye, EyeOff, Pencil, Trash2, ExternalLink } from "lucide-react";
import { useLandmarks } from "@/hooks/useLandmarks";
import { updateLandmark, deleteLandmark } from "@/lib/landmarkClient";
import { landmarkMeta } from "@/lib/landmarks";
import type { Landmark } from "@/types";
import { AdminPage, Button, Card, EmptyState, Hint, RowsSkeleton, Tag, landmarkIcon } from "./ui";
import { LandmarkEditSheet, landmarkErr } from "./LandmarkEditSheet";

/** Admin · Places — the live map's named places (active + hidden). */
export function PlacesBody() {
  const { landmarks, loading, refresh } = useLandmarks("all");
  const { signMessageAsync } = useSignMessage();
  const sign = (m: string) => signMessageAsync({ message: m });

  const [query, setQuery]         = useState("");
  const [editing, setEditing]     = useState<Landmark | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId]       = useState<string | null>(null);
  const [err, setErr]             = useState("");

  const filtered = useMemo(() => {
    // Pending suggestions live on the Suggestions tab — this page manages only
    // the live map (active + hidden).
    const base = landmarks.filter((l) => l.status !== "pending");
    const q = query.trim().toLowerCase();
    const list = q ? base.filter((l) => l.name.toLowerCase().includes(q)) : base;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [landmarks, query]);

  async function toggleHide(l: Landmark) {
    setBusyId(l.id); setErr("");
    try {
      await updateLandmark(sign, l.id, { status: l.status === "active" ? "hidden" : "active" });
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      await refresh();
    } catch (e) { const m = landmarkErr(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }
  async function doDelete(id: string) {
    setBusyId(id); setErr("");
    try {
      await deleteLandmark(sign, id);
      setConfirmDel(null);
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      await refresh();
    } catch (e) { const m = landmarkErr(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }

  return (
    <AdminPage
      title="Map places"
      subtitle="Name a place from the map's label tool. Names show to everyone; hidden ones don't."
    >
      {/* Search */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && query) setQuery(""); }}
          placeholder="Search places"
          aria-label="Search places"
          className="w-full h-14 rounded-full bg-white border border-line pl-6 pr-14 text-sm/none text-heading
            placeholder:text-nav-muted outline-none focus:border-brand motion-safe:transition-colors"
        />
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label={query ? "Clear search" : "Search"}
          className="absolute top-1/2 right-5 -translate-y-1/2 text-heading cursor-pointer"
        >
          {query ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
        </button>
      </div>

      <Hint text={err} tone="bad" className="mt-3 px-1" />

      {loading ? (
        <RowsSkeleton count={4} height="h-28" />
      ) : filtered.length === 0 ? (
        <Card className="mt-3">
          <EmptyState
            icon={MapPin}
            title={query ? "No matches" : "No places yet"}
            body={query ? undefined : "Add the first one from the map's label tool."}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3 mt-3">
          {filtered.map((l) => {
            const meta = landmarkMeta(l.category);
            const Icon = landmarkIcon(l.category);
            const hidden = l.status === "hidden";
            const busy = busyId === l.id;
            return (
              <Card key={l.id} className={hidden ? "opacity-70" : ""}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-11.5 h-11.5 rounded-full bg-surface flex items-center justify-center text-heading shrink-0">
                    <Icon className="w-5 h-5" strokeWidth={1.75} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg/none text-heading flex items-center gap-2 min-w-0">
                      <span className="truncate">{l.name}</span> {hidden && <Tag>Hidden</Tag>}
                    </p>
                    <p className="text-sm/none text-nav-muted mt-2 truncate">
                      {meta.label} · {l.lat.toFixed(4)}, {l.lng.toFixed(4)}
                    </p>
                  </div>
                </div>
                {l.note && <p className="text-sm/[140%] text-nav-muted mt-3">{l.note}</p>}

                <div className="flex gap-2 mt-4 flex-wrap">
                  <Button size="sm" onClick={() => { setEditing(l); setErr(""); }} disabled={busy}>
                    <Pencil className="w-4 h-4" strokeWidth={2} /> Edit
                  </Button>
                  <Button size="sm" onClick={() => window.open(`/?focus=${l.lat},${l.lng}`, "_blank", "noopener")} disabled={busy}>
                    <ExternalLink className="w-4 h-4" strokeWidth={2} /> Preview
                  </Button>
                  <Button size="sm" onClick={() => toggleHide(l)} busy={busy && confirmDel !== l.id}>
                    {hidden ? <Eye className="w-4 h-4" strokeWidth={2} /> : <EyeOff className="w-4 h-4" strokeWidth={2} />}
                    {hidden ? "Show" : "Hide"}
                  </Button>
                  {confirmDel === l.id ? (
                    <Button size="sm" variant="danger" onClick={() => doDelete(l.id)} busy={busy} className="ml-auto">
                      Confirm delete
                    </Button>
                  ) : (
                    <Button size="sm" variant="danger" onClick={() => { setConfirmDel(l.id); setErr(""); }} disabled={busy} className="ml-auto">
                      <Trash2 className="w-4 h-4" strokeWidth={2} /> Delete
                    </Button>
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
          title="Edit place"
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); window.dispatchEvent(new CustomEvent("gd:landmarks-updated")); refresh(); }}
        />
      )}
    </AdminPage>
  );
}
