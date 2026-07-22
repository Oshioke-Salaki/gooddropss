"use client";
import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSignMessage } from "wagmi";
import { X, Loader2, MapPin, Check } from "lucide-react";
import {
  LANDMARK_CATEGORIES, LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
  LANDMARK_DEDUPE_M, cleanLandmarkName,
} from "@/lib/landmarks";
import { createLandmark } from "@/lib/landmarkClient";
import { haversineDistance } from "@/lib/utils";
import type { Landmark, LandmarkCategory } from "@/types";

interface Props {
  placing: boolean;                       // "tap the map" mode is active
  picked: { lat: number; lng: number } | null; // a point was tapped
  landmarks: Landmark[];                  // for the nearby-duplicate hint
  mode?: "admin" | "suggest";             // admin adds live; suggest → review queue
  onCancel: () => void;                   // exit placing / discard the pick
  onRepick: () => void;                   // go back to tapping the map
  onCreated: () => void;                  // saved — refresh + close
}

export function LandmarkCreator({ placing, picked, landmarks, mode = "admin", onCancel, onRepick, onCreated }: Props) {
  const isSuggest = mode === "suggest";
  const { signMessageAsync } = useSignMessage();
  const [name, setName]         = useState("");
  const [category, setCategory] = useState<LandmarkCategory>("landmark");
  const [note, setNote]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [done, setDone]         = useState(false);

  // Reset the form each time a fresh point is picked.
  useEffect(() => {
    if (picked) { setName(""); setNote(""); setCategory("landmark"); setError(""); setDone(false); }
  }, [picked]);

  const cleanName = cleanLandmarkName(name);
  const nameOk = cleanName.length >= LANDMARK_NAME_MIN && cleanName.length <= LANDMARK_NAME_MAX;

  const nearbyDupe = useMemo(() => {
    if (!picked) return null;
    return landmarks.find(
      (l) => l.status === "active" &&
        haversineDistance(picked.lat, picked.lng, l.lat, l.lng) < LANDMARK_DEDUPE_M,
    ) ?? null;
  }, [picked, landmarks]);

  async function save() {
    if (!picked || !nameOk || saving) return;
    setSaving(true);
    setError("");
    try {
      await createLandmark(
        (message) => signMessageAsync({ message }),
        { name: cleanName, category, lat: picked.lat, lng: picked.lng, note: note.trim() || undefined },
      );
      setDone(true);
      window.dispatchEvent(new CustomEvent("gd:landmarks-updated"));
      setTimeout(() => { onCreated(); setDone(false); }, 900);
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as Error)?.message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "" : (msg || "Couldn't save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Instruction banner while tapping the map */}
      <AnimatePresence>
        {placing && !picked && (
          <motion.div
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            style={{
              position: "fixed", top: "calc(70px + var(--gd-banner-h, 0px))", left: "50%",
              transform: "translateX(-50%)", zIndex: 1100,
              display: "flex", alignItems: "center", gap: 10,
              background: "#111", color: "#fff",
              border: "2px solid #BFFD00", borderRadius: 100,
              padding: "8px 10px 8px 14px", maxWidth: "calc(100vw - 24px)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)", fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <MapPin size={15} color="#BFFD00" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Move the map so 📍 is on the spot
            </span>
            <button
              onClick={onCancel} aria-label="Cancel"
              style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 999, border: "none", background: "#333", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form sheet after a point is picked */}
      <AnimatePresence>
        {picked && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }} onClick={onCancel}
              style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(17,17,17,0.55)", backdropFilter: "blur(3px)" }}
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 34, stiffness: 430 }}
              role="dialog" aria-modal="true" aria-label="Name this place"
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

              {done ? (
                <div style={{ textAlign: "center", padding: "16px 8px" }}>
                  <div style={{ fontSize: 44, marginBottom: 6 }}>{isSuggest ? "🙌" : "📍"}</div>
                  <p style={{ margin: 0, fontWeight: 900, fontSize: 19, color: "#111" }}>
                    {isSuggest ? `“${cleanName}” suggested` : `“${cleanName}” added`}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6b6e7a" }}>
                    {isSuggest ? "Thanks! An admin will review it soon." : "It’s now on the map for everyone."}
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: 19, color: "#111", letterSpacing: "-0.02em" }}>
                        {isSuggest ? "Suggest a place" : "Name this place"}
                      </p>
                      <button
                        onClick={onRepick}
                        style={{ marginTop: 3, padding: 0, border: "none", background: "none", cursor: "pointer", color: "#6b6e7a", fontSize: 12, fontWeight: 600, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <MapPin size={12} /> {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)} · change
                      </button>
                    </div>
                    <button onClick={onCancel} aria-label="Close" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, border: "2px solid #111", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <X size={16} color="#111" />
                    </button>
                  </div>

                  {/* Name */}
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value); setError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && nameOk) save(); }}
                    placeholder="e.g. Colab Campus"
                    maxLength={LANDMARK_NAME_MAX + 8}
                    autoFocus
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
                        <button
                          key={c.id}
                          onClick={() => setCategory(c.id)}
                          style={{
                            flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
                            padding: "8px 12px", borderRadius: 100, cursor: "pointer",
                            border: "2px solid #111", fontFamily: "inherit",
                            fontWeight: 800, fontSize: 12.5,
                            background: active ? "#111" : "#fff",
                            color: active ? "#fff" : "#111",
                            boxShadow: active ? "none" : "2px 2px 0 #111",
                          }}
                        >
                          <span>{c.icon}</span>{c.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Optional note */}
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

                  {nearbyDupe && (
                    <p style={{ margin: "10px 0 0", fontSize: 12, color: "#b8860b", fontWeight: 700 }}>
                      ⚠️ “{nearbyDupe.name}” is already tagged right here — sure this is different?
                    </p>
                  )}
                  {error && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#dc2626", fontWeight: 700 }}>{error}</p>}

                  <button
                    onClick={save}
                    disabled={!nameOk || saving}
                    style={{
                      marginTop: 14, width: "100%", height: 52,
                      background: nameOk ? "#BFFD00" : "#e8e7e2",
                      color: nameOk ? "#111" : "#a8a8a2",
                      border: "2.5px solid", borderColor: nameOk ? "#111" : "#d6d5cf",
                      borderRadius: 15, fontWeight: 900, fontSize: 16, fontFamily: "inherit",
                      cursor: nameOk && !saving ? "pointer" : "not-allowed",
                      boxShadow: nameOk ? "4px 4px 0 #111" : "none",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}
                  >
                    {saving
                      ? <><Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> Signing…</>
                      : <><Check size={17} /> {isSuggest ? "Suggest place" : "Add place"}</>}
                  </button>
                  <p style={{ margin: "9px 0 0", fontSize: 11, color: "#9a9da8", textAlign: "center" }}>
                    {isSuggest
                      ? "You sign to confirm — free, no gas. An admin reviews before it appears."
                      : "You sign to confirm — free, no gas."}
                  </p>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
