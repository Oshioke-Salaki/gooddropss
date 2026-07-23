"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSignMessage } from "wagmi";
import { X, Loader2, Check, Trash2, EyeOff, Eye } from "lucide-react";
import {
  LANDMARK_CATEGORIES, landmarkMeta, cleanLandmarkName,
  LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
} from "@/lib/landmarks";
import { updateLandmark, deleteLandmark } from "@/lib/landmarkClient";
import type { Landmark, LandmarkCategory } from "@/types";

function errMsg(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage
    ?? (e as Error)?.message ?? "";
  return /reject|denied|cancel/i.test(m) ? "" : (m || "Something went wrong.");
}

interface Props {
  landmark: Landmark | null;   // the tapped place; null = closed
  onClose: () => void;
  onChanged: () => void;       // saved / hidden / deleted → refresh the map
}

// Admin: tap a place on the map → edit its name/category/note, hide it, or delete
// it, right where you see it. Signature-based (free, no gas), server re-verifies
// the admin.
export function LandmarkManageSheet({ landmark, onClose, onChanged }: Props) {
  const { signMessageAsync } = useSignMessage();
  const sign = (m: string) => signMessageAsync({ message: m });

  const [name, setName]         = useState("");
  const [category, setCategory] = useState<LandmarkCategory>("landmark");
  const [note, setNote]         = useState("");
  const [busy, setBusy]         = useState<"" | "save" | "hide" | "delete">("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError]       = useState("");

  // Re-seed the form whenever a different place is opened.
  useEffect(() => {
    if (landmark) {
      setName(landmark.name);
      setCategory(landmark.category);
      setNote(landmark.note ?? "");
      setConfirmDel(false);
      setError("");
    }
  }, [landmark]);

  // Lock background scroll while the sheet is open.
  useEffect(() => {
    if (!landmark) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [landmark]);

  const cleanName = cleanLandmarkName(name);
  const nameOk = cleanName.length >= LANDMARK_NAME_MIN && cleanName.length <= LANDMARK_NAME_MAX;
  const dirty = !!landmark && (
    cleanName !== landmark.name ||
    category !== landmark.category ||
    (note.trim() || "") !== (landmark.note ?? "")
  );
  const anyBusy = busy !== "";

  async function save() {
    if (!landmark || !nameOk || anyBusy) return;
    setBusy("save"); setError("");
    try {
      await updateLandmark(sign, landmark.id, { name: cleanName, category, note: note.trim() });
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      onChanged();
      onClose();
    } catch (e) { const m = errMsg(e); if (m) setError(m); }
    finally { setBusy(""); }
  }

  async function toggleHide() {
    if (!landmark || anyBusy) return;
    setBusy("hide"); setError("");
    try {
      await updateLandmark(sign, landmark.id, { status: landmark.status === "active" ? "hidden" : "active" });
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      onChanged();
      onClose();
    } catch (e) { const m = errMsg(e); if (m) setError(m); }
    finally { setBusy(""); }
  }

  async function remove() {
    if (!landmark || anyBusy) return;
    setBusy("delete"); setError("");
    try {
      await deleteLandmark(sign, landmark.id);
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      onChanged();
      onClose();
    } catch (e) { const m = errMsg(e); if (m) setError(m); }
    finally { setBusy(""); }
  }

  const meta = landmark ? landmarkMeta(landmark.category) : null;
  const hidden = landmark?.status === "hidden";

  return (
    <AnimatePresence>
      {landmark && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }} onClick={anyBusy ? undefined : onClose}
            style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(17,17,17,0.55)", backdropFilter: "blur(3px)" }}
          />
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 34, stiffness: 430 }}
            role="dialog" aria-modal="true" aria-label="Manage place"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 3001,
              width: "100%", maxWidth: 480, margin: "0 auto",
              background: "#f5f4f0", borderRadius: "24px 24px 0 0",
              border: "2px solid #111", borderBottom: "none",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.35)",
              padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
              maxHeight: "92dvh", overflowY: "auto",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <div style={{ width: 40, height: 4, borderRadius: 999, background: "#d6d5cf", margin: "0 auto 14px" }} />

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <span style={{
                  width: 34, height: 34, flexShrink: 0, borderRadius: 10,
                  border: "2px solid #111", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 17, background: `${meta?.color ?? "#BFFD00"}22`,
                }}>{meta?.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 900, fontSize: 18, color: "#111", letterSpacing: "-0.02em" }}>Edit place</p>
                  <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "#888", fontWeight: 600 }}>
                    {landmark.lat.toFixed(5)}, {landmark.lng.toFixed(5)}{hidden ? " · hidden" : ""}
                  </p>
                </div>
              </div>
              <button onClick={anyBusy ? undefined : onClose} aria-label="Close" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, border: "2px solid #111", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} color="#111" />
              </button>
            </div>

            {/* Name */}
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && nameOk && dirty) save(); }}
              placeholder="Place name"
              maxLength={LANDMARK_NAME_MAX + 8}
              style={{
                marginTop: 14, width: "100%", height: 52, boxSizing: "border-box",
                background: "#fff", border: "2px solid #111", borderRadius: 14,
                padding: "0 14px", fontSize: 17, fontWeight: 800, color: "#111",
                fontFamily: "inherit", outline: "none",
                boxShadow: nameOk ? "3px 3px 0 #BFFD00" : "3px 3px 0 #111",
              }}
            />

            {/* Category chips */}
            <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 12, paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
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

            {/* Note */}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (e.g. main gate)"
              maxLength={LANDMARK_NOTE_MAX}
              style={{
                marginTop: 12, width: "100%", height: 44, boxSizing: "border-box",
                background: "#fff", border: "2px solid #e0ded6", borderRadius: 12,
                padding: "0 12px", fontSize: 14, fontWeight: 600, color: "#333",
                fontFamily: "inherit", outline: "none",
              }}
            />

            {error && <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "#dc2626", fontWeight: 700 }}>{error}</p>}

            {/* Save */}
            <button
              onClick={save}
              disabled={!nameOk || !dirty || anyBusy}
              style={{
                marginTop: 14, width: "100%", height: 52,
                background: nameOk && dirty ? "#BFFD00" : "#e8e7e2",
                color: nameOk && dirty ? "#111" : "#a8a8a2",
                border: "2.5px solid", borderColor: nameOk && dirty ? "#111" : "#d6d5cf",
                borderRadius: 15, fontWeight: 900, fontSize: 16, fontFamily: "inherit",
                cursor: nameOk && dirty && !anyBusy ? "pointer" : "not-allowed",
                boxShadow: nameOk && dirty ? "4px 4px 0 #111" : "none",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {busy === "save"
                ? <><Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> Signing…</>
                : <><Check size={17} /> Save changes</>}
            </button>

            {/* Secondary: hide/show + delete */}
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                onClick={toggleHide}
                disabled={anyBusy}
                style={{
                  flex: 1, height: 46, background: "#fff", color: "#111",
                  border: "2px solid #111", borderRadius: 13, fontWeight: 800, fontSize: 13.5,
                  cursor: anyBusy ? "not-allowed" : "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                {busy === "hide"
                  ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                  : hidden ? <><Eye size={15} /> Show on map</> : <><EyeOff size={15} /> Hide</>}
              </button>
              {confirmDel ? (
                <button
                  onClick={remove}
                  disabled={anyBusy}
                  style={{
                    flex: 1, height: 46, background: "#FFE5E5", color: "#C81E1E",
                    border: "2px solid #C81E1E", borderRadius: 13, fontWeight: 900, fontSize: 13.5,
                    cursor: anyBusy ? "not-allowed" : "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  {busy === "delete"
                    ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                    : <><Trash2 size={15} /> Confirm delete</>}
                </button>
              ) : (
                <button
                  onClick={() => { setConfirmDel(true); setError(""); }}
                  disabled={anyBusy}
                  style={{
                    flex: 1, height: 46, background: "#fff", color: "#C81E1E",
                    border: "2px solid #C81E1E", borderRadius: 13, fontWeight: 800, fontSize: 13.5,
                    cursor: anyBusy ? "not-allowed" : "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  <Trash2 size={15} /> Delete
                </button>
              )}
            </div>

            <p style={{ margin: "10px 0 0", fontSize: 11, color: "#9a9da8", textAlign: "center" }}>
              You sign to confirm — free, no gas.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
