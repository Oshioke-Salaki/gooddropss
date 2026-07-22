"use client";
import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { Nav } from "@/components/Nav";
import { useLandmarks } from "@/hooks/useLandmarks";
import { isAdminAddress } from "@/lib/admins";
import { updateLandmark, deleteLandmark } from "@/lib/landmarkClient";
import {
  LANDMARK_CATEGORIES, landmarkMeta, cleanLandmarkName,
  LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
} from "@/lib/landmarks";
import type { Landmark, LandmarkCategory } from "@/types";

function errMsg(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage
    ?? (e as Error)?.message ?? "";
  return /reject|denied|cancel/i.test(m) ? "" : (m || "Something went wrong.");
}

export default function AdminPlacesPage() {
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);
  const { landmarks, loading, refresh } = useLandmarks("all");
  const { signMessageAsync } = useSignMessage();
  const sign = (m: string) => signMessageAsync({ message: m });

  const [query, setQuery]         = useState("");
  const [editing, setEditing]     = useState<Landmark | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId]       = useState<string | null>(null);
  const [err, setErr]             = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? landmarks.filter((l) => l.name.toLowerCase().includes(q)) : landmarks;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [landmarks, query]);

  async function toggleHide(l: Landmark) {
    setBusyId(l.id); setErr("");
    try {
      await updateLandmark(sign, l.id, { status: l.status === "active" ? "hidden" : "active" });
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      await refresh();
    } catch (e) { const m = errMsg(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }
  async function doDelete(id: string) {
    setBusyId(id); setErr("");
    try {
      await deleteLandmark(sign, id);
      setConfirmDel(null);
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      await refresh();
    } catch (e) { const m = errMsg(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }

  if (!isAdmin) {
    return (
      <div style={{ minHeight: "100dvh", background: "#f5f4f0" }}>
        <Nav />
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "100px 20px", textAlign: "center", fontFamily: "'Space Grotesk', sans-serif" }}>
          <div style={{ fontSize: 48 }}>🔒</div>
          <p style={{ fontWeight: 900, fontSize: 20 }}>Admin only</p>
          <p style={{ color: "#888" }}>{address ? "This wallet isn't an admin." : "Connect an admin wallet."}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <Nav />
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "84px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Map places</h1>
          <Link href="/" style={{ fontSize: 13, fontWeight: 800, color: "#111", textDecoration: "underline" }}>← Map</Link>
        </div>
        <p style={{ color: "#5a5a5a", fontSize: 13.5, margin: "4px 0 16px" }}>
          Name a place from the map (🏷️ button). Names show to everyone; hidden ones don’t.
        </p>

        {/* Search */}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search places…"
          className="border-2 border-ink rounded-xl"
          style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", fontSize: 15, fontWeight: 600, background: "#fff", outline: "none", fontFamily: "inherit" }}
        />

        {err && <p style={{ margin: "12px 0 0", color: "#C81E1E", fontWeight: 700, fontSize: 13 }}>{err}</p>}

        {loading ? (
          <p style={{ textAlign: "center", padding: 40, color: "#888", fontWeight: 700 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "#888" }}>
            <div style={{ fontSize: 40 }}>📍</div>
            <p style={{ fontWeight: 800, margin: "8px 0 0" }}>{query ? "No matches" : "No places yet"}</p>
            {!query && <p style={{ fontSize: 13, margin: "4px 0 0" }}>Add the first from the map’s 🏷️ button.</p>}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {filtered.map((l) => {
              const meta = landmarkMeta(l.category);
              const hidden = l.status === "hidden";
              const busy = busyId === l.id;
              return (
                <div key={l.id} style={{
                  background: "#fff", border: "2px solid #111", borderRadius: 14,
                  padding: "12px 14px", boxShadow: "2px 2px 0 #111",
                  opacity: hidden ? 0.6 : 1,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      width: 36, height: 36, flexShrink: 0, borderRadius: 10,
                      border: "2px solid #111", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 17, background: `${meta.color}22`,
                    }}>{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {l.name} {hidden && <span style={{ fontSize: 10, fontWeight: 800, color: "#999" }}>· hidden</span>}
                      </p>
                      <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "#888", fontWeight: 600 }}>
                        {meta.label} · {l.lat.toFixed(4)}, {l.lng.toFixed(4)}
                      </p>
                    </div>
                  </div>
                  {l.note && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#555" }}>{l.note}</p>}

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => { setEditing(l); setErr(""); }} disabled={busy} style={miniBtn("#fff")}>Edit</button>
                    <button onClick={() => toggleHide(l)} disabled={busy} style={miniBtn("#fff")}>
                      {busy ? "…" : hidden ? "Show" : "Hide"}
                    </button>
                    {confirmDel === l.id ? (
                      <button onClick={() => doDelete(l.id)} disabled={busy} style={miniBtn("#FFE5E5", "#C81E1E")}>
                        {busy ? "…" : "Confirm delete"}
                      </button>
                    ) : (
                      <button onClick={() => { setConfirmDel(l.id); setErr(""); }} disabled={busy} style={{ ...miniBtn("#fff"), marginLeft: "auto", color: "#C81E1E", borderColor: "#C81E1E" }}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <EditSheet
          landmark={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); window.dispatchEvent(new CustomEvent("gd:landmarks-updated")); refresh(); }}
        />
      )}
    </div>
  );
}

function miniBtn(bg: string, color = "#111"): React.CSSProperties {
  return {
    padding: "8px 12px", background: bg, color,
    border: `2px solid ${color === "#111" ? "#111" : color}`, borderRadius: 10,
    fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
    boxShadow: "2px 2px 0 rgba(17,17,17,0.15)",
  };
}

// ── Edit sheet ────────────────────────────────────────────────────────────────
function EditSheet({ landmark, onClose, onSaved }: { landmark: Landmark; onClose: () => void; onSaved: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [name, setName]         = useState(landmark.name);
  const [category, setCategory] = useState<LandmarkCategory>(landmark.category);
  const [note, setNote]         = useState(landmark.note ?? "");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  // Prevent background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const cleanName = cleanLandmarkName(name);
  const nameOk = cleanName.length >= LANDMARK_NAME_MIN && cleanName.length <= LANDMARK_NAME_MAX;

  async function save() {
    if (!nameOk || saving) return;
    setSaving(true); setError("");
    try {
      await updateLandmark(
        (m) => signMessageAsync({ message: m }),
        landmark.id,
        { name: cleanName, category, note: note.trim() },
      );
      onSaved();
    } catch (e) { const m = errMsg(e); if (m) setError(m); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(17,17,17,0.55)", backdropFilter: "blur(3px)" }} />
      <div
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 3001,
          width: "100%", maxWidth: 480, margin: "0 auto",
          background: "#f5f4f0", borderRadius: "24px 24px 0 0",
          border: "2px solid #111", borderBottom: "none",
          padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
          maxHeight: "92dvh", overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 999, background: "#d6d5cf", margin: "0 auto 14px" }} />
        <p style={{ margin: 0, fontWeight: 900, fontSize: 19 }}>Edit place</p>

        <input
          value={name} onChange={(e) => { setName(e.target.value); setError(""); }}
          maxLength={LANDMARK_NAME_MAX + 8}
          style={{ marginTop: 12, width: "100%", height: 50, boxSizing: "border-box", background: "#fff", border: "2px solid #111", borderRadius: 14, padding: "0 14px", fontSize: 16, fontWeight: 800, color: "#111", fontFamily: "inherit", outline: "none" }}
        />

        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 12, paddingBottom: 2 }}>
          {LANDMARK_CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button key={c.id} onClick={() => setCategory(c.id)}
                style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", borderRadius: 100, cursor: "pointer", border: "2px solid #111", fontFamily: "inherit", fontWeight: 800, fontSize: 12.5, background: active ? "#111" : "#fff", color: active ? "#fff" : "#111", boxShadow: active ? "none" : "2px 2px 0 #111" }}>
                <span>{c.icon}</span>{c.label}
              </button>
            );
          })}
        </div>

        <input
          value={note} onChange={(e) => setNote(e.target.value)} maxLength={LANDMARK_NOTE_MAX}
          placeholder="Optional note"
          style={{ marginTop: 12, width: "100%", height: 44, boxSizing: "border-box", background: "#fff", border: "2px solid #e0ded6", borderRadius: 12, padding: "0 12px", fontSize: 14, fontWeight: 600, color: "#333", fontFamily: "inherit", outline: "none" }}
        />

        {error && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#dc2626", fontWeight: 700 }}>{error}</p>}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={{ flex: "0 0 auto", padding: "0 18px", height: 50, background: "#fff", color: "#111", border: "2px solid #111", borderRadius: 14, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={save} disabled={!nameOk || saving}
            style={{ flex: 1, height: 50, background: nameOk ? "#BFFD00" : "#e8e7e2", color: nameOk ? "#111" : "#a8a8a2", border: "2.5px solid", borderColor: nameOk ? "#111" : "#d6d5cf", borderRadius: 14, fontWeight: 900, fontSize: 15, cursor: nameOk && !saving ? "pointer" : "not-allowed", fontFamily: "inherit", boxShadow: nameOk ? "3px 3px 0 #111" : "none" }}>
            {saving ? "Signing…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}
