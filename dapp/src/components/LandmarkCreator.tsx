"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSignMessage } from "wagmi";
import {
  X, Loader2, MapPin, Check, GraduationCap, School, ShoppingCart, Church,
  TrafficCone, Building2, Trees, TrainFront, type LucideIcon,
} from "lucide-react";
import {
  LANDMARK_CATEGORIES, LANDMARK_NAME_MIN, LANDMARK_NAME_MAX, LANDMARK_NOTE_MAX,
  LANDMARK_DEDUPE_M, cleanLandmarkName,
} from "@/lib/landmarks";
import { createLandmark } from "@/lib/landmarkClient";
import { haversineDistance } from "@/lib/utils";
import { Sheet } from "@/components/ui/Sheet";
import type { Landmark, LandmarkCategory } from "@/types";

// One icon per category, replacing the emoji the data layer still carries.
// Shared with LandmarkManageSheet so the two forms can't drift.
const CATEGORY_ICON: Record<LandmarkCategory, LucideIcon> = {
  landmark:  MapPin,
  campus:    GraduationCap,
  school:    School,
  market:    ShoppingCart,
  worship:   Church,
  junction:  TrafficCone,
  estate:    Building2,
  park:      Trees,
  transport: TrainFront,
};

export function CategoryIcon({ category, className = "w-4 h-4" }: { category: LandmarkCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? MapPin;
  return <Icon className={className} strokeWidth={2} />;
}

/** Horizontal, scrollable category picker. Full-bleed inside a Sheet. */
export function CategoryChips({
  value, onChange, disabled,
}: { value: LandmarkCategory; onChange: (c: LandmarkCategory) => void; disabled?: boolean }) {
  return (
    <div
      role="radiogroup"
      aria-label="Category"
      className="no-scrollbar flex gap-2 overflow-x-auto -mx-6 px-6 py-0.5"
    >
      {LANDMARK_CATEGORIES.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(c.id)}
            className={`shrink-0 flex items-center gap-2 h-10 pl-3.5 pr-4 rounded-full text-sm/none cursor-pointer
              motion-safe:transition-colors disabled:cursor-not-allowed ${
              on ? "bg-nav-active text-white" : "border border-line bg-white text-heading hover:bg-surface"
            }`}
          >
            <CategoryIcon category={c.id} className="w-4 h-4" />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** Shared input look for the name / note fields. */
export const FIELD =
  "w-full rounded-full bg-surface px-5 text-heading placeholder:text-nav-muted border border-transparent " +
  "outline-none motion-safe:transition-colors focus:border-brand disabled:opacity-60";

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

  const nameRef = useRef<HTMLInputElement>(null);

  // Reset the form each time a fresh point is picked. Focus the name on desktop
  // only — on a phone that would throw the keyboard up before the sheet lands —
  // and after the sheet has taken focus, so it isn't stolen straight back.
  useEffect(() => {
    if (!picked) return;
    setName(""); setNote(""); setCategory("landmark"); setError(""); setDone(false);
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const t = setTimeout(() => nameRef.current?.focus(), 300);
    return () => clearTimeout(t);
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

  const hint = error
    ? { text: error, tone: "bad" as const }
    : nearbyDupe
      ? { text: `“${nearbyDupe.name}” is already tagged right here — sure this is different?`, tone: "warn" as const }
      : null;

  return (
    <>
      {/* Instruction banner while positioning the map */}
      <AnimatePresence>
        {placing && !picked && (
          <motion.div
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            role="status"
            className="fixed left-1/2 -translate-x-1/2 z-[1100] max-w-[calc(100vw-24px)] font-sans
              flex items-center gap-2.5 rounded-full bg-white shadow-[0px_0px_12px_0px_#0000000A] p-1.5 pl-4"
            style={{
              top: "calc(var(--spacing-nav) + var(--gd-banner-h, 0px) + 12px)",
              transition: "top 0.2s ease",
            }}
          >
            <MapPin className="w-4 h-4 shrink-0 text-brand" strokeWidth={2} />
            <span className="text-sm/none text-heading truncate">Move the map so the pin is on the spot</span>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel"
              className="w-8 h-8 shrink-0 rounded-full bg-surface text-nav-muted flex items-center justify-center
                cursor-pointer motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form sheet after a point is picked */}
      {picked && (
        <Sheet
          title={isSuggest ? "Suggest a place" : "Name this place"}
          onClose={onCancel}
          dismissible={!saving && !done}
          zIndex={3000}
        >
          {done ? (
            <div className="flex flex-col items-center text-center pt-8 pb-2 gap-y-4">
              <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
                <Check className="w-7 h-7" strokeWidth={2} />
              </span>
              <p className="text-xl/none text-heading">
                {isSuggest ? `“${cleanName}” suggested` : `“${cleanName}” added`}
              </p>
              <p className="text-sm/[140%] text-nav-muted">
                {isSuggest ? "Thanks. An admin will review it soon." : "It's now on the map for everyone."}
              </p>
            </div>
          ) : (
            <form className="flex flex-col" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <button
                type="button"
                onClick={onRepick}
                disabled={saving}
                className="mt-3 self-start flex items-center gap-1.5 text-sm/none text-nav-muted cursor-pointer
                  motion-safe:transition-colors hover:text-heading disabled:cursor-not-allowed"
              >
                <MapPin className="w-3.5 h-3.5" strokeWidth={2} />
                {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
                <span className="text-brand">· change</span>
              </button>

              <label className="block mt-6">
                <span className="sr-only">Place name</span>
                <input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(""); }}
                  placeholder="e.g. Colab Campus"
                  maxLength={LANDMARK_NAME_MAX + 8}
                  ref={nameRef}
                  disabled={saving}
                  className={`${FIELD} h-14 text-base/none`}
                />
              </label>

              <div className="mt-3">
                <CategoryChips value={category} onChange={setCategory} disabled={saving} />
              </div>

              <label className="block mt-3">
                <span className="sr-only">Note</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note (e.g. main gate)"
                  maxLength={LANDMARK_NOTE_MAX}
                  disabled={saving}
                  className={`${FIELD} h-12 text-sm/none`}
                />
              </label>

              {/* Fixed-height slot so the button never jumps as hints come and go. */}
              <p
                role="status"
                aria-live="polite"
                className={`min-h-4 mt-3 px-5 text-sm/[130%] ${
                  hint?.tone === "bad" ? "text-danger" : "text-streak"
                }`}
              >
                {hint?.text ?? ""}
              </p>

              <button
                type="submit"
                disabled={!nameOk || saving}
                className="mt-3 w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2
                  cursor-pointer motion-safe:transition-colors hover:bg-brand/90
                  disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
              >
                {saving
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing…</>
                  : (isSuggest ? "Suggest place" : "Add place")}
              </button>
              <p className="mt-4 text-xs/[140%] text-nav-muted text-center">
                {isSuggest
                  ? "You sign to confirm — free, no gas. An admin reviews before it appears."
                  : "You sign to confirm — free, no gas."}
              </p>
            </form>
          )}
        </Sheet>
      )}
    </>
  );
}
