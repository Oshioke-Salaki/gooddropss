"use client";
import { useState, useMemo, useEffect } from "react";
import { useAccount, useSignMessage } from "wagmi";
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

function timeAgo(unixSec: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000) - unixSec);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function AdminSuggestionsPage() {
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);
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
    } catch (e) { const m = errMsg(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }
  async function reject(id: string) {
    setBusyId(id); setErr("");
    try {
      await deleteLandmark(sign, id);
      setConfirmRej(null);
      announce();
      await refresh();
    } catch (e) { const m = errMsg(e); if (m) setErr(m); }
    finally { setBusyId(null); }
  }

  if (!isAdmin) {
    return (
      <div style={{ minHeight: "100dvh", background: "#f5f4f0" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "80px 20px", textAlign: "center", fontFamily: "'Space Grotesk', sans-serif" }}>
          <div style={{ fontSize: 48 }}>🔒</div>
          <p style={{ fontWeight: 900, fontSize: 20 }}>Admin only</p>
          <p style={{ color: "#888" }}>{address ? "This wallet isn't an admin." : "Connect an admin wallet."}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "28px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Suggestions</h1>
          {pending.length > 0 && (
            <span style={{ background: "#FF5C5C", color: "#fff", fontWeight: 900, fontSize: 13, padding: "3px 10px", borderRadius: 999 }}>
              {pending.length}
            </span>
          )}
        </div>
        <p style={{ color: "#5a5a5a", fontSize: 13.5, margin: "4px 0 18px" }}>
          Places suggested by verified hunters. Approve to put them on the map, or reject to discard.
        </p>

        {err && <p style={{ margin: "0 0 12px", color: "#C81E1E", fontWeight: 700, fontSize: 13 }}>{err}</p>}

        {loading ? (
          <p style={{ textAlign: "center", padding: 40, color: "#888", fontWeight: 700 }}>Loading…</p>
        ) : pending.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 20px", color: "#888" }}>
            <div style={{ fontSize: 44 }}>🎉</div>
            <p style={{ fontWeight: 900, margin: "10px 0 0", color: "#111", fontSize: 17 }}>All caught up</p>
            <p style={{ fontSize: 13, margin: "4px 0 0" }}>No suggestions waiting for review.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pending.map((l) => {
              const meta = landmarkMeta(l.category);
              const busy = busyId === l.id;
              const mapsUrl = `https://www.google.com/maps?q=${l.lat},${l.lng}`;
              return (
                <div key={l.id} style={{
                  background: "#fff", border: "2px solid #111", borderRadius: 16,
                  padding: "14px 15px", boxShadow: "3px 3px 0 #111",
                  opacity: busy ? 0.6 : 1, transition: "opacity 0.15s",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                    <span style={{
                      width: 40, height: 40, flexShrink: 0, borderRadius: 11,
                      border: "2px solid #111", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 19, background: `${meta.color}22`,
                    }}>{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 16, lineHeight: 1.2, wordBreak: "break-word" }}>{l.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#888", fontWeight: 600 }}>
                        {meta.label} · suggested {timeAgo(l.createdAt)}
                      </p>
                    </div>
                  </div>

                  {l.note && (
                    <p style={{ margin: "10px 0 0", fontSize: 13, color: "#444", background: "#f5f4f0", borderRadius: 10, padding: "8px 11px" }}>
                      “{l.note}”
                    </p>
                  )}

                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10, fontSize: 11.5, color: "#888", fontWeight: 600 }}>
                    <button
                      onClick={() => window.open(`/?focus=${l.lat},${l.lng}`, "_blank", "noopener")}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#111", fontFamily: "inherit", fontSize: 11.5, fontWeight: 800, textDecoration: "underline" }}>
                      📍 Preview on map
                    </button>
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                      style={{ color: "#2563eb", textDecoration: "underline", fontWeight: 700 }}>
                      Google ↗
                    </a>
                    <span style={{ color: "#aaa" }}>{l.lat.toFixed(4)}, {l.lng.toFixed(4)} · {short(l.createdBy)}</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
                    <button onClick={() => approve(l)} disabled={busy}
                      style={{ flex: 1, height: 44, background: "#BFFD00", color: "#111", border: "2.5px solid #111", borderRadius: 12, fontWeight: 900, fontSize: 14, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", boxShadow: "2px 2px 0 #111" }}>
                      {busy ? "…" : "✓ Approve"}
                    </button>
                    <button onClick={() => { setEditing(l); setErr(""); }} disabled={busy}
                      style={{ padding: "0 14px", height: 44, background: "#fff", color: "#111", border: "2px solid #111", borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                      Edit
                    </button>
                    {confirmRej === l.id ? (
                      <button onClick={() => reject(l.id)} disabled={busy}
                        style={{ padding: "0 14px", height: 44, background: "#FFE5E5", color: "#C81E1E", border: "2px solid #C81E1E", borderRadius: 12, fontWeight: 900, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                        {busy ? "…" : "Confirm"}
                      </button>
                    ) : (
                      <button onClick={() => { setConfirmRej(l.id); setErr(""); }} disabled={busy}
                        style={{ padding: "0 14px", height: 44, background: "#fff", color: "#C81E1E", border: "2px solid #C81E1E", borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                        Reject
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
          onSaved={() => { setEditing(null); announce(); refresh(); }}
        />
      )}
    </div>
  );
}

// Fix a typo / re-categorise a suggestion before approving. Saving keeps it
// pending (status untouched) — the admin still makes the explicit approve call.
function EditSheet({ landmark, onClose, onSaved }: { landmark: Landmark; onClose: () => void; onSaved: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [name, setName]         = useState(landmark.name);
  const [category, setCategory] = useState<LandmarkCategory>(landmark.category);
  const [note, setNote]         = useState(landmark.note ?? "");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

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
    } catch (e) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as Error)?.message ?? "";
      if (!/reject|denied|cancel/i.test(m)) setError(m || "Something went wrong.");
    } finally { setSaving(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(17,17,17,0.55)", backdropFilter: "blur(3px)" }} />
      <div role="dialog" aria-modal="true"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 3001,
          width: "100%", maxWidth: 480, margin: "0 auto",
          background: "#f5f4f0", borderRadius: "24px 24px 0 0",
          border: "2px solid #111", borderBottom: "none",
          padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
          maxHeight: "92dvh", overflowY: "auto", fontFamily: "'Space Grotesk', sans-serif",
        }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: "#d6d5cf", margin: "0 auto 14px" }} />
        <p style={{ margin: 0, fontWeight: 900, fontSize: 19 }}>Tidy up before approving</p>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#888" }}>Saving keeps it in the queue — approve from the list after.</p>

        <input
          value={name} onChange={(e) => { setName(e.target.value); setError(""); }}
          maxLength={LANDMARK_NAME_MAX + 8}
          style={{ marginTop: 14, width: "100%", height: 50, boxSizing: "border-box", background: "#fff", border: "2px solid #111", borderRadius: 14, padding: "0 14px", fontSize: 16, fontWeight: 800, color: "#111", fontFamily: "inherit", outline: "none" }}
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
